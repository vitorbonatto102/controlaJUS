-- Relatórios por origem do mesmo fechamento. Sem criar/reabrir fechamentos.
begin;
-- A substituição precisa estar vinculada ao original antes dos AFTER INSERT
-- (comissões e identidade do fechamento). Apenas a rotina privilegiada, que
-- executa como dona da tabela, pode fornecer esse vínculo no INSERT.
create or replace function public.set_actor() returns trigger language plpgsql
set search_path='' as $$
begin
  if tg_table_name='payments' then
    new.recorded_by:=auth.uid();new.voided_at:=null;new.voided_by:=null;new.void_reason:=null;
    if current_user<>pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.payments'::regclass)) then
      new.replaces_payment_id:=null;
    end if;
  elsif tg_table_name='collection_notes' then new.author_id:=auth.uid();end if;
  return new;
end $$;
do $$
declare v_signature text;d text;
begin
  foreach v_signature in array array['private.revise_manager_payment(uuid,text,bigint,date)',
    'private.revise_closed_payment(uuid,text,bigint,date)','private.revise_secretary_payment(uuid,text,bigint,date)'] loop
    d:=replace(pg_get_functiondef(v_signature::regprocedure),E'\r\n',E'\n');
    if v_signature like '%secretary%' then
      d:=replace(d,'insert into public.payments (installment_id, payment_date, amount_paid, observation)',
        'insert into public.payments (installment_id, payment_date, amount_paid, observation, replaces_payment_id)');
      d:=replace(d,E'p_new_amount_cents::numeric / 100,\n      v_payment.observation)', E'p_new_amount_cents::numeric / 100,\n      v_payment.observation, p_payment_id)');
      d:=replace(d,'update public.payments set replaces_payment_id = p_payment_id where id = v_new_id;', '');
    else
      d:=replace(d,'insert into public.payments(installment_id,payment_date,amount_paid,observation)',
        'insert into public.payments(installment_id,payment_date,amount_paid,observation,replaces_payment_id)');
      d:=replace(d,'p_new_amount_cents::numeric / 100,v_old.observation)', 'p_new_amount_cents::numeric / 100,v_old.observation,p_payment)');
      d:=replace(d,'update public.payments set replaces_payment_id = p_payment where id = v_new;', '');
    end if;
    execute d;
  end loop;
end $$;
alter table public.closing_adjustments add column if not exists report_origin text,
  add column if not exists report_client_name text,add column if not exists report_recipient_name text;
alter table public.commercial_closing_adjustments add column if not exists report_origin text,
  add column if not exists report_client_name text,add column if not exists report_recipient_name text;
create or replace function private.closing_payment_identity(p_payment uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with recursive lineage as (
    select p.id,p.replaces_payment_id,0 as depth from public.payments p where p.id=p_payment
    union all select p.id,p.replaces_payment_id,l.depth+1 from lineage l join public.payments p on p.id=l.replaces_payment_id where l.depth<100
  ), original as (
    select x.origin,x.client_name,x.recipient_name as commercial_recipient_name from (
      select s.origin,s.client_name,s.commercial_recipient_name as recipient_name,l.depth,0 as priority from lineage l join public.monthly_closing_items s on s.payment_id=l.id
      union all select a.report_origin,a.report_client_name,a.report_recipient_name,l.depth,1 from lineage l join public.closing_adjustments a on a.source_payment_id=l.id where a.report_origin is not null
    ) x order by x.priority,x.depth limit 1
  ) select jsonb_build_object('contract_id',c.id,'origin',coalesce(o.origin,c.origin),'client_name',coalesce(o.client_name,cl.full_name),
      'recipient_name',coalesce(o.commercial_recipient_name,t.commercial_recipient_name))
    from public.payments p join public.installments i on i.id=p.installment_id join public.contracts c on c.id=i.contract_id
    join public.clients cl on cl.id=c.client_id join public.contract_financial_terms t on t.contract_id=c.id left join original o on true where p.id=p_payment;
$$;
create or replace function private.capture_closing_report_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_identity jsonb;v_payment uuid;
begin
  if tg_table_name='closing_adjustments' then v_payment:=new.source_payment_id;else v_payment:=new.payment_id;end if;
  v_identity:=private.closing_payment_identity(v_payment);
  new.report_origin:=v_identity->>'origin';new.report_client_name:=v_identity->>'client_name';new.report_recipient_name:=v_identity->>'recipient_name';
  return new;
end $$;
drop trigger if exists adjustments_capture_origin on public.closing_adjustments;
create trigger adjustments_capture_origin before insert on public.closing_adjustments for each row execute function private.capture_closing_report_identity();
drop trigger if exists commercial_adjustments_capture_origin on public.commercial_closing_adjustments;
create trigger commercial_adjustments_capture_origin before insert on public.commercial_closing_adjustments for each row execute function private.capture_closing_report_identity();

create or replace function public.closed_month_origin_report(p_closing uuid,p_origins text[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.monthly_closings%rowtype;b jsonb;v_rows jsonb;v_recipients jsonb;v_origins text[];v_received numeric;v_lawyer numeric;v_conflicts integer;
begin
  if auth.uid() is null or coalesce(private.current_role(),'') not in ('lawyer','manager') or not private.office_owns_record('monthly_closings',p_closing) then raise exception 'Acesso não autorizado' using errcode='42501';end if;
  select * into c from public.monthly_closings where id=p_closing;
  if not found or c.status='draft' or c.closed_at is null or (private.current_role()='lawyer' and c.lawyer_id<>auth.uid()) then raise exception 'Fechamento indisponível' using errcode='P0002';end if;
  if p_origins is null or cardinality(p_origins)>3 or exists(select 1 from unnest(p_origins) x where x is null or x not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP')) then raise exception 'Selecione origens válidas' using errcode='22023';end if;
  select coalesce(array_agg(distinct x order by x),'{}') into v_origins from unnest(p_origins) x;
  b:=public.closed_month_report(p_closing);
  if exists(select 1 from public.closing_adjustments where closing_id=p_closing and source_payment_id is null) then raise exception 'Há ajustes sem pagamento identificado. Solicite a conferência do gestor antes de separar por origem';end if;
  with flows as (
    select s.payment_id,i.contract_id,s.payment_date,s.client_name,s.origin,coalesce(s.commercial_recipient_name,t.commercial_recipient_name) as recipient_name,
      s.amount_received as received,s.commission_amount as lawyer,s.commercial_amount as third
      from public.monthly_closing_items s join public.payments p on p.id=s.payment_id join public.installments i on i.id=p.installment_id
      join public.contract_financial_terms t on t.contract_id=i.contract_id where s.closing_id=p_closing
    union all
    select a.source_payment_id,i.contract_id,p.payment_date,coalesce(a.report_client_name,identity.data->>'client_name'),coalesce(a.report_origin,identity.data->>'origin'),
      coalesce(a.report_recipient_name,identity.data->>'recipient_name'),a.office_delta,a.commission_delta,0
      from public.closing_adjustments a join public.payments p on p.id=a.source_payment_id join public.installments i on i.id=p.installment_id
      cross join lateral(select private.closing_payment_identity(p.id) as data) identity where a.closing_id=p_closing
    union all
    select a.payment_id,i.contract_id,p.payment_date,coalesce(a.report_client_name,identity.data->>'client_name'),coalesce(a.report_origin,identity.data->>'origin'),
      coalesce(a.report_recipient_name,identity.data->>'recipient_name'),0,0,a.amount
      from public.commercial_closing_adjustments a join public.payments p on p.id=a.payment_id join public.installments i on i.id=p.installment_id
      cross join lateral(select private.closing_payment_identity(p.id) as data) identity where a.closing_id=p_closing
  ), grouped as (
    select payment_id,contract_id,payment_date,max(client_name) as client_name,origin,max(recipient_name) as recipient_name,sum(received) as received_amount,sum(lawyer) as lawyer_amount,sum(third) as third_party_amount
      from flows group by payment_id,contract_id,payment_date,origin
  ), selected as (
    select * from grouped where (cardinality(v_origins)=0 or origin=any(v_origins)) and (received_amount<>0 or lawyer_amount<>0 or third_party_amount<>0)
  ), recipients as (
    select contract_id,client_name,origin,b->>'lawyer_name' as name,'lawyer' as kind,lawyer_amount as amount from selected
    union all select contract_id,client_name,origin,coalesce(recipient_name,'Beneficiário ainda não informado'),case when origin='Tráfego HP' then 'commercial' else 'third_party' end,third_party_amount from selected
  ), recipient_totals as (
    select contract_id,client_name,origin,name,kind,sum(amount) as amount from recipients group by contract_id,client_name,origin,name,kind having sum(amount)<>0
  ) select (select coalesce(jsonb_agg(to_jsonb(s) order by s.payment_date,s.payment_id),'[]') from selected s),
      (select coalesce(jsonb_agg(to_jsonb(r) order by r.client_name,r.kind,r.name),'[]') from recipient_totals r),
      (select coalesce(sum(received_amount),0) from grouped),(select coalesce(sum(lawyer_amount),0) from grouped),
      (select count(*) from (select payment_id from flows group by payment_id having count(distinct origin)>1) conflicts)
    into v_rows,v_recipients,v_received,v_lawyer,v_conflicts;
  if v_conflicts>0 then raise exception 'Há ajustes com origem divergente para o mesmo pagamento. Solicite conferência ao gestor';end if;
  if v_received<>c.office_amount_received+c.office_adjustment_amount or v_lawyer<>c.commission_amount+c.adjustment_amount then
    raise exception 'A composição e os ajustes divergem dos totais. Solicite conferência antes de emitir o relatório';end if;
  return jsonb_build_object('version',2,'issued_at',b->'issued_at','office_name',b->'office_name','lawyer_name',b->'lawyer_name','origins',to_jsonb(v_origins),
    'closing',jsonb_build_object('id',c.id,'reference_month',c.reference_month,'reference_year',c.reference_year,'closed_at',c.closed_at),
    'rows',v_rows,'recipients',v_recipients)||case when cardinality(v_origins)=0 then jsonb_build_object('full_report',b) else '{}' end;
end $$;
revoke all on function private.closing_payment_identity(uuid),private.capture_closing_report_identity() from public,anon,authenticated;
revoke all on function public.closed_month_origin_report(uuid,text[]) from public,anon,authenticated;
grant execute on function public.closed_month_origin_report(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
