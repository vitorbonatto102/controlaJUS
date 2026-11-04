-- Relatório emitido imutável e recebimento confirmado pela própria advogada.
-- O gestor acompanha; não há segunda aprovação nem operação bancária automática.
begin;
create table if not exists public.payout_reports (
  id uuid primary key,office_id uuid not null references public.offices(id),
  lawyer_id uuid not null references public.profiles(id),closing_id uuid not null references public.monthly_closings(id),
  origins text[] not null default '{}',snapshot jsonb not null,items jsonb not null,
  amount_due numeric(14,2) not null check(amount_due>0),created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),check(cardinality(origins)<=3),
  check(origins<@array['Cliente próprio','Propriedade Intelectual','Tráfego HP']::text[]),
  check(jsonb_typeof(snapshot)='object' and jsonb_typeof(items)='array')
);
create index if not exists payout_reports_lawyer_time on public.payout_reports(lawyer_id,created_at desc);
alter table public.payout_reports enable row level security;
revoke all on public.payout_reports from anon,authenticated;
grant select on public.payout_reports to authenticated;
drop policy if exists payout_reports_read on public.payout_reports;
create policy payout_reports_read on public.payout_reports for select to authenticated using(
  office_id=private.current_office_id() and (private.current_role()='manager' or (private.current_role()='lawyer' and lawyer_id=auth.uid())));
create or replace function private.reject_payout_report_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Relatório emitido é imutável. Emita um novo relatório para atualizar a posição';end $$;
drop trigger if exists payout_reports_immutable on public.payout_reports;
create trigger payout_reports_immutable before update or delete on public.payout_reports for each row execute function private.reject_payout_report_mutation();
alter table public.commission_transfers add column if not exists payout_report_id uuid references public.payout_reports(id),
  add column if not exists confirmation_request_id uuid;
create unique index if not exists transfers_receipt_request on public.commission_transfers(confirmation_request_id) where confirmation_request_id is not null;
create index if not exists transfers_payout_report on public.commission_transfers(payout_report_id) where payout_report_id is not null;
alter table public.commission_transfers drop constraint if exists transfers_receipt_link;
alter table public.commission_transfers add constraint transfers_receipt_link check(
  (payout_report_id is null)=(confirmation_request_id is null));

create or replace function private.authorized_payout_report(p_report uuid) returns public.payout_reports
language plpgsql stable security definer set search_path='' as $$
declare r public.payout_reports%rowtype;
begin
  if auth.uid() is null or coalesce(private.current_role(),'') not in ('lawyer','manager') then raise exception 'Acesso não autorizado' using errcode='42501';end if;
  select * into r from public.payout_reports where id=p_report and office_id=private.current_office_id()
    and (private.current_role()='manager' or lawyer_id=auth.uid());
  if not found then raise exception 'Relatório indisponível' using errcode='P0002';end if;
  return r;
end $$;

-- Usa a origem histórica do fechamento e os vínculos reais de repasse. Um contrato
-- com várias origens no mesmo mês exige conferência, sem rateio arbitrário do legado.
create or replace function private.payout_report_balances(p_closing uuid,p_origins text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b jsonb;a jsonb;f record;v_item jsonb;v_items jsonb:='[]';
begin
  b:=public.closed_month_origin_report(p_closing,'{}');
  a:=public.closing_payout_agenda(p_closing);
  if jsonb_array_length(a->'unallocated_transfers')>0 then
    raise exception 'Há repasses anteriores já registrados sem vínculo aos contratos. Solicite a conferência desses vínculos antes de confirmar outro recebimento';end if;
  for f in select r->>'contract_id' as contract_id,max(r->>'client_name') as client_name,array_agg(distinct r->>'origin') as origins,
      sum((r->>'lawyer_amount')::numeric) as amount,
      md5(jsonb_agg(jsonb_build_array(r->>'payment_id',r->>'payment_date',r->>'origin',r->'received_amount',r->'lawyer_amount',r->'third_party_amount',r->>'recipient_name') order by r->>'payment_id')::text) as fingerprint
    from jsonb_array_elements(b->'rows') r group by r->>'contract_id' loop
    if cardinality(p_origins)>0 and not(f.origins&&p_origins) then continue;end if;
    if cardinality(f.origins)>1 then raise exception 'Contrato com mais de uma origem no fechamento exige conferência antes de emitir o relatório para repasse';end if;
    if f.amount<=0 then continue;end if;
    select value into v_item from jsonb_array_elements(a->'items') where value->>'contract_id'=f.contract_id and value->>'recipient'='lawyer';
    if v_item is null or (v_item->>'amount')::numeric<>f.amount then raise exception 'A composição e o saldo por contrato divergem. Solicite conferência ao gestor';end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('contract_id',f.contract_id,'client_name',f.client_name,'origin',f.origins[1],
      'commission_cents',round(f.amount*100)::bigint,'balance_cents',round((v_item->>'balance')::numeric*100)::bigint,'fingerprint',f.fingerprint));
  end loop;
  return v_items;
end $$;

create or replace function public.issue_payout_report(p_report uuid,p_closing uuid,p_origins text[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.monthly_closings%rowtype;r public.payout_reports%rowtype;v_origins text[];v_items jsonb;v_total numeric;v_snapshot jsonb;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado';end if;
  if p_report is null or p_origins is null or cardinality(p_origins)>3 or exists(select 1 from unnest(p_origins) x where x is null or x not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP')) then raise exception 'Selecione origens válidas';end if;
  select coalesce(array_agg(distinct x order by x),'{}') into v_origins from unnest(p_origins) x;
  perform private.lock_lawyer_finance(auth.uid());
  select * into c from public.monthly_closings where id=p_closing and lawyer_id=auth.uid() and private.office_owns_record('monthly_closings',id) for update;
  if not found or c.status='draft' or c.closed_at is null then raise exception 'Fechamento indisponível';end if;
  select * into r from public.payout_reports where id=p_report;
  if found then
    if r.lawyer_id<>auth.uid() or r.office_id<>private.current_office_id() or r.closing_id<>p_closing or r.origins<>v_origins then raise exception 'Solicitação de emissão inválida';end if;
    return r.id;
  end if;
  select coalesce(jsonb_agg(value order by value->>'contract_id'),'[]') into v_items from jsonb_array_elements(private.payout_report_balances(p_closing,v_origins)) where (value->>'balance_cents')::numeric>0;
  select coalesce(sum((value->>'balance_cents')::numeric),0)/100 into v_total from jsonb_array_elements(v_items);
  if v_total<=0 then raise exception 'Não há saldo a receber para estas origens. Você pode consultar o demonstrativo do fechamento';end if;
  if v_total>c.amount_pending_transfer then raise exception 'Os saldos exigem conferência antes de emitir nova solicitação de repasse';end if;
  v_snapshot:=public.closed_month_participation_report(p_closing,v_origins)-'full_report';
  insert into public.payout_reports(id,office_id,lawyer_id,closing_id,origins,snapshot,items,amount_due,created_by)
    values(p_report,private.current_office_id(),auth.uid(),p_closing,v_origins,v_snapshot,v_items,v_total,auth.uid());
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,new_value,reason)
    values(auth.uid(),auth.uid(),'payout_reports',p_report,'issued',jsonb_build_object('closing_id',p_closing,'origins',v_origins,'amount_due',v_total),'Relatório emitido pela advogada para recebimento');
  return p_report;
end $$;

create or replace function private.payout_report_available(p_report uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.payout_reports%rowtype;s jsonb;c jsonb;v_current jsonb;v_used numeric;v_available bigint;v_items jsonb:='[]';v_total bigint:=0;v_stale boolean:=false;
begin
  select * into r from public.payout_reports where id=p_report;
  v_current:=private.payout_report_balances(r.closing_id,r.origins);
  for s in select value from jsonb_array_elements(r.items) order by value->>'contract_id' loop
    select value into c from jsonb_array_elements(v_current) where value->>'contract_id'=s->>'contract_id';
    if c is null or c->>'fingerprint' is distinct from s->>'fingerprint' then v_stale:=true;end if;
    select coalesce(sum(a.amount),0)*100 into v_used from public.commission_transfer_allocations a join public.commission_transfers t on t.id=a.transfer_id
      where t.payout_report_id=r.id and t.reversed_at is null and a.contract_id=(s->>'contract_id')::uuid;
    v_available:=greatest(0,least((s->>'balance_cents')::numeric-v_used,coalesce((c->>'balance_cents')::numeric,0)))::bigint;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('contract_id',s->>'contract_id','available_cents',v_available));v_total:=v_total+v_available;
  end loop;
  return jsonb_build_object('items',v_items,'available_cents',v_total,'stale',v_stale);
end $$;

create or replace function public.get_payout_report(p_report uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.payout_reports%rowtype;v_availability jsonb;v_error text;
begin
  r:=private.authorized_payout_report(p_report);
  begin v_availability:=private.payout_report_available(p_report);exception when raise_exception then
    v_availability:=jsonb_build_object('available_cents',0,'stale',true);v_error:=sqlerrm;end;
  return to_jsonb(r)||(v_availability-'items')||jsonb_build_object('availability_error',v_error,'receipts',coalesce((select jsonb_agg(jsonb_build_object(
    'id',t.id,'amount',t.amount,'payment_date',t.payment_date,'notes',t.notes,'recorded_by',t.recorded_by,'created_at',t.created_at,
    'reversed_at',t.reversed_at,'reversal_reason',t.reversal_reason) order by t.created_at,t.id) from public.commission_transfers t where t.payout_report_id=p_report),'[]'));
end $$;

create or replace function private.notify_lawyer_receipt(p_lawyer uuid,p_report uuid,p_amount numeric,p_reversed boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,type,title,message,related_record_id)
    select p.id,case when p_reversed then 'payout_receipt_reversed' else 'payout_receipt_confirmed' end,
      case when p_reversed then 'Confirmação de recebimento desfeita' else 'Recebimento confirmado pela advogada' end,
      (select full_name from public.profiles where id=p_lawyer)||case when p_reversed then ' desfez a confirmação de ' else ' confirmou o recebimento de ' end||
      'R$ '||translate(to_char(p_amount,'FM999G999G999G990D00'),'.,',',.')||' referente ao relatório '||left(p_report::text,8)||'.'||
      case when nullif(trim(p_reason),'') is null then '' else ' Observação: '||trim(p_reason) end,p_report
    from public.profiles p where p.office_id=private.current_office_id() and p.role='manager' and p.active;
end $$;

create or replace function public.confirm_payout_receipt(p_report uuid,p_request uuid,p_amount_cents bigint,p_date date,p_notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.payout_reports%rowtype;c public.monthly_closings%rowtype;t public.commission_transfers%rowtype;a jsonb;i jsonb;
  v_id uuid;v_total numeric;v_accumulated numeric:=0;v_previous bigint:=0;v_share bigint;v_rounded bigint;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado';end if;
  r:=private.authorized_payout_report(p_report);perform private.lock_lawyer_finance(r.lawyer_id);
  select * into c from public.monthly_closings where id=r.closing_id for update;
  if p_request is null or p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>99999999999999 or p_date is null or
    p_date<(make_date(c.reference_year,c.reference_month,1)+interval '1 month')::date or p_date>(now() at time zone 'America/Sao_Paulo')::date or length(coalesce(p_notes,''))>1000 then
    raise exception 'Informe o valor e a data reais do recebimento, após a competência e sem data futura';end if;
  select * into t from public.commission_transfers where confirmation_request_id=p_request;
  if found then
    if t.payout_report_id is distinct from p_report or t.recorded_by is distinct from auth.uid() or t.amount<>p_amount_cents::numeric/100 or t.payment_date<>p_date or t.notes is distinct from nullif(trim(p_notes),'') or t.reversed_at is not null then raise exception 'Solicitação de confirmação já utilizada';end if;
    return t.id;
  end if;
  a:=private.payout_report_available(p_report);
  if (a->>'stale')::boolean then raise exception 'Os valores do fechamento mudaram desde a emissão. Emita um novo relatório antes de confirmar';end if;
  v_total:=(a->>'available_cents')::numeric;
  if p_amount_cents>v_total or p_amount_cents::numeric/100>c.amount_pending_transfer then raise exception 'O valor excede o saldo disponível deste relatório. Confira os recebimentos já confirmados';end if;
  insert into public.commission_transfers(closing_id,lawyer_id,amount,payment_date,notes,recorded_by,payout_report_id,confirmation_request_id)
    values(c.id,auth.uid(),p_amount_cents::numeric/100,p_date,nullif(trim(p_notes),''),auth.uid(),p_report,p_request) returning id into v_id;
  for i in select value from jsonb_array_elements(a->'items') order by value->>'contract_id' loop
    v_accumulated:=v_accumulated+(i->>'available_cents')::numeric;
    v_rounded:=round(p_amount_cents::numeric*v_accumulated/v_total)::bigint;v_share:=v_rounded-v_previous;v_previous:=v_rounded;
    if v_share>0 then insert into public.commission_transfer_allocations(transfer_id,contract_id,amount,recorded_by)
      values(v_id,(i->>'contract_id')::uuid,v_share::numeric/100,auth.uid());end if;
  end loop;
  if v_previous<>p_amount_cents then raise exception 'Não foi possível conciliar os centavos do recebimento';end if;
  perform private.refresh_closing(c.id);
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,new_value,reason)
    values(auth.uid(),auth.uid(),'commission_transfers',v_id,'receipt_confirmed',jsonb_build_object('report_id',p_report,'amount',p_amount_cents::numeric/100,'payment_date',p_date,'origins',r.origins),
      'Recebimento confirmado pela advogada'||case when nullif(trim(p_notes),'') is null then '' else ': '||trim(p_notes) end);
  perform private.notify_lawyer_receipt(auth.uid(),p_report,p_amount_cents::numeric/100,false,p_notes);
  return v_id;
end $$;

create or replace function public.reverse_own_payout_receipt(p_transfer uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.commission_transfers%rowtype;r public.payout_reports%rowtype;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado';end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Informe o motivo da correção';end if;
  perform private.lock_lawyer_finance(auth.uid());
  select * into t from public.commission_transfers where id=p_transfer and lawyer_id=auth.uid() and recorded_by=auth.uid() and payout_report_id is not null and reversed_at is null for update;
  if not found then raise exception 'Confirmação indisponível';end if;
  r:=private.authorized_payout_report(t.payout_report_id);
  update public.commission_transfers set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=trim(p_reason) where id=t.id;
  perform private.refresh_closing(t.closing_id);
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(auth.uid(),auth.uid(),'commission_transfers',t.id,'receipt_reversed',jsonb_build_object('report_id',r.id,'amount',t.amount),jsonb_build_object('reversed_at',now()),trim(p_reason));
  perform private.notify_lawyer_receipt(auth.uid(),r.id,t.amount,true,p_reason);
end $$;

revoke all on function private.reject_payout_report_mutation(),private.authorized_payout_report(uuid),private.payout_report_balances(uuid,text[]),
  private.payout_report_available(uuid),private.notify_lawyer_receipt(uuid,uuid,numeric,boolean,text) from public,anon,authenticated;
revoke all on function public.issue_payout_report(uuid,uuid,text[]),public.get_payout_report(uuid),public.confirm_payout_receipt(uuid,uuid,bigint,date,text),public.reverse_own_payout_receipt(uuid,text) from public,anon,authenticated;
grant execute on function public.issue_payout_report(uuid,uuid,text[]),public.get_payout_report(uuid),public.confirm_payout_receipt(uuid,uuid,bigint,date,text),public.reverse_own_payout_receipt(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
