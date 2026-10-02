-- Etapa 4. Fechamentos imutáveis, ajustes posteriores, repasses e correções
-- transacionais. Migrations anteriores permanecem intactas.

alter table public.monthly_closings drop constraint monthly_closings_status_check;
alter table public.monthly_closings add constraint monthly_closings_status_check
  check (status in ('draft', 'closed', 'partial', 'paid'));
alter table public.monthly_closings
  add column adjustment_amount numeric(14,2) not null default 0,
  add column office_adjustment_amount numeric(14,2) not null default 0,
  add column amount_overpaid numeric(14,2) not null default 0 check (amount_overpaid >= 0);

create table public.monthly_closing_items (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.monthly_closings(id),
  payment_id uuid not null references public.payments(id),
  commission_id uuid not null references public.commissions(id),
  payment_date date not null,
  client_name text not null,
  origin text not null,
  amount_received numeric(14,2) not null check (amount_received > 0),
  commission_percentage numeric(5,2) not null,
  commission_amount numeric(14,2) not null check (commission_amount >= 0),
  created_at timestamptz not null default now(),
  unique (closing_id, payment_id),
  unique (payment_id)
);
comment on table public.monthly_closing_items is 'Snapshot original do fechamento; nunca reescrito por correções posteriores.';

create table public.closing_adjustments (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.monthly_closings(id),
  source_payment_id uuid references public.payments(id),
  office_delta numeric(14,2) not null default 0,
  commission_delta numeric(14,2) not null default 0,
  reason text not null check (length(trim(reason)) >= 5),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (office_delta <> 0 or commission_delta <> 0)
);
comment on table public.closing_adjustments is 'Lançamento complementar após fechamento; preserva a composição e totais originais.';

create table public.commission_transfers (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.monthly_closings(id),
  lawyer_id uuid not null references public.profiles(id),
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  notes text check (notes is null or length(notes) <= 1000),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  reversal_reason text,
  check ((reversed_at is null and reversed_by is null and reversal_reason is null) or
    (reversed_at is not null and reversed_by is not null and length(trim(reversal_reason)) >= 5))
);

create index payments_active_date on public.payments (payment_date, installment_id) where voided_at is null;
create index installments_due_date on public.installments (due_date, contract_id);
create index closings_lawyer_period on public.monthly_closings (lawyer_id, reference_year desc, reference_month desc);
create index closing_items_closing on public.monthly_closing_items (closing_id);
create index closing_adjustments_closing on public.closing_adjustments (closing_id, created_at);
create index transfers_closing_active on public.commission_transfers (closing_id, payment_date) where reversed_at is null;
create index audit_record on public.audit_logs (table_name, record_id, created_at desc);
create index profiles_role_active on public.profiles (role, active, full_name);

alter table public.monthly_closing_items enable row level security;
alter table public.closing_adjustments enable row level security;
alter table public.commission_transfers enable row level security;
revoke all on table public.monthly_closing_items, public.closing_adjustments,
  public.commission_transfers from anon, authenticated;
grant select on table public.monthly_closing_items, public.closing_adjustments,
  public.commission_transfers to authenticated;
create policy closing_items_read on public.monthly_closing_items for select to authenticated
  using (exists (select 1 from public.monthly_closings c where c.id = closing_id
    and ((select private.current_role()) in ('manager','admin') or
      ((select private.current_role()) = 'lawyer' and c.lawyer_id = (select auth.uid())))));
create policy closing_adjustments_read on public.closing_adjustments for select to authenticated
  using (exists (select 1 from public.monthly_closings c where c.id = closing_id
    and ((select private.current_role()) in ('manager','admin') or
      ((select private.current_role()) = 'lawyer' and c.lawyer_id = (select auth.uid())))));
create policy transfers_read on public.commission_transfers for select to authenticated
  using ((select private.current_role()) in ('manager','admin') or
    ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid())));

-- Administração e gestão financeira só usam RPCs validadas. O admin não pode
-- mais alterar perfis diretamente pela API sem motivo e log.
revoke update on public.profiles from authenticated;
drop policy profiles_admin_update on public.profiles;

create function private.refresh_closing(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_original numeric(14,2);
  v_delta numeric(14,2);
  v_office_delta numeric(14,2);
  v_transferred numeric(14,2);
  v_balance numeric(14,2);
  v_last_transfer_date date;
begin
  select commission_amount into v_original from public.monthly_closings where id = p_id for update;
  if not found then raise exception 'Fechamento não encontrado'; end if;
  select coalesce(sum(commission_delta),0), coalesce(sum(office_delta),0)
    into v_delta, v_office_delta from public.closing_adjustments where closing_id = p_id;
  select coalesce(sum(amount),0), max(payment_date) into v_transferred, v_last_transfer_date
    from public.commission_transfers
    where closing_id = p_id and reversed_at is null;
  v_balance := v_original + v_delta - v_transferred;
  update public.monthly_closings set adjustment_amount = v_delta,
    office_adjustment_amount = v_office_delta,
    amount_already_transferred = v_transferred,
    amount_pending_transfer = greatest(v_balance,0),
    amount_overpaid = greatest(-v_balance,0),
    status = case when v_balance <= 0 and v_transferred > 0 then 'paid'
      when v_transferred > 0 then 'partial' else 'closed' end,
    paid_at = case when v_balance <= 0 and v_transferred > 0 then
      (v_last_transfer_date::timestamp at time zone 'America/Sao_Paulo') else null end
  where id = p_id;
end;
$$;
revoke all on function private.refresh_closing(uuid) from public, anon, authenticated;

create function private.log_manager_change(p_lawyer uuid, p_table text, p_record uuid,
  p_field text, p_old jsonb, p_new jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.audit_logs(user_id, affected_lawyer_id, table_name, record_id,
    field_name, old_value, new_value, reason)
  values (auth.uid(), p_lawyer, p_table, p_record, p_field, p_old, p_new, trim(p_reason))
  returning id into v_id;
  if p_lawyer is not null then
    insert into public.notifications(user_id, type, title, message, related_record_id)
    values (p_lawyer, 'manager_correction', 'Informação corrigida',
      'O gestor corrigiu ' || p_table || '.' || p_field || '. Anterior: ' ||
      coalesce(p_old::text,'—') || '. Atual: ' || coalesce(p_new::text,'—') ||
      '. Motivo: ' || trim(p_reason), p_record);
  end if;
  return v_id;
end;
$$;
revoke all on function private.log_manager_change(uuid,text,uuid,text,jsonb,jsonb,text)
  from public, anon, authenticated;

-- Ajusta apenas meses já consolidados. Mês aberto receberá o pagamento novo
-- normalmente no fechamento futuro.
create function private.add_closed_adjustment(p_lawyer uuid, p_date date,
  p_payment uuid, p_office_delta numeric, p_commission_delta numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_closing uuid;
begin
  if p_office_delta = 0 and p_commission_delta = 0 then return; end if;
  select id into v_closing from public.monthly_closings
    where lawyer_id = p_lawyer and reference_year = extract(year from p_date)
      and reference_month = extract(month from p_date) and status <> 'draft' for update;
  if v_closing is not null then
    insert into public.closing_adjustments(closing_id, source_payment_id, office_delta,
      commission_delta, reason, recorded_by)
    values (v_closing, p_payment, p_office_delta, p_commission_delta, trim(p_reason), auth.uid());
    perform private.refresh_closing(v_closing);
  end if;
end;
$$;
revoke all on function private.add_closed_adjustment(uuid,date,uuid,numeric,numeric,text)
  from public, anon, authenticated;

create function private.confirm_monthly_closing(p_lawyer uuid, p_month smallint, p_year smallint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_start date;
  v_end date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null or private.current_role() <> 'manager' then raise exception 'Acesso não autorizado'; end if;
  if p_lawyer is null or p_month is null or p_year is null or
     p_month not between 1 and 12 or p_year not between 2000 and 9999 or
     not exists (select 1 from public.profiles where id = p_lawyer and role = 'lawyer') then
    raise exception 'Período ou advogada inválidos';
  end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;
  if v_today < v_end - 1 then raise exception 'O fechamento só pode ser confirmado no último dia do mês ou depois'; end if;
  perform pg_advisory_xact_lock(hashtext(p_lawyer::text || v_start::text));
  if exists (select 1 from public.monthly_closings where lawyer_id = p_lawyer
    and reference_month = p_month and reference_year = p_year) then
    raise exception 'Já existe fechamento para esta advogada e período';
  end if;
  insert into public.monthly_closings(lawyer_id,reference_month,reference_year,
    status,closed_at) values(p_lawyer,p_month,p_year,'closed',now()) returning id into v_id;
  insert into public.monthly_closing_items(closing_id,payment_id,commission_id,
    payment_date,client_name,origin,amount_received,commission_percentage,commission_amount)
  select v_id,p.id,cm.id,p.payment_date,cl.full_name,c.origin,p.amount_paid,
    cm.commission_percentage,cm.commission_amount
  from public.payments p join public.commissions cm on cm.payment_id = p.id and cm.lawyer_id = p_lawyer
  join public.installments i on i.id = p.installment_id
  join public.contracts c on c.id = i.contract_id
  join public.clients cl on cl.id = c.client_id
  where p.voided_at is null and p.payment_date >= v_start and p.payment_date < v_end;
  update public.monthly_closings set
    office_amount_received = (select coalesce(sum(amount_received),0)
      from public.monthly_closing_items where closing_id = v_id),
    commission_amount = (select coalesce(sum(commission_amount),0)
      from public.monthly_closing_items where closing_id = v_id)
  where id = v_id;
  perform private.refresh_closing(v_id);
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,
    field_name,old_value,new_value,reason)
  values(auth.uid(),p_lawyer,'monthly_closings',v_id,'created',null,
    jsonb_build_object('month',p_month,'year',p_year),'Fechamento mensal confirmado');
  return v_id;
end;
$$;
revoke all on function private.confirm_monthly_closing(uuid,smallint,smallint) from public, anon, authenticated;

create function public.confirm_monthly_closing(p_lawyer uuid, p_month smallint, p_year smallint)
returns uuid language sql security invoker set search_path = '' as $$
  select private.confirm_monthly_closing(p_lawyer,p_month,p_year);
$$;
revoke all on function public.confirm_monthly_closing(uuid,smallint,smallint) from public, anon, authenticated;
grant execute on function private.confirm_monthly_closing(uuid,smallint,smallint),
  public.confirm_monthly_closing(uuid,smallint,smallint) to authenticated;

create function private.register_commission_transfer(p_closing uuid, p_amount_cents bigint,
  p_date date, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_closing public.monthly_closings%rowtype; v_id uuid;
begin
  if auth.uid() is null or private.current_role() <> 'manager' then raise exception 'Acesso não autorizado'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 99999999999999
    or p_date is null or length(coalesce(p_notes,'')) > 1000 then raise exception 'Dados do repasse inválidos'; end if;
  select * into v_closing from public.monthly_closings where id = p_closing for update;
  if not found or v_closing.status = 'draft' then raise exception 'Fechamento indisponível'; end if;
  if p_amount_cents::numeric / 100 > v_closing.amount_pending_transfer then
    raise exception 'Repasse maior que o saldo. Corrija o fechamento antes de prosseguir';
  end if;
  insert into public.commission_transfers(closing_id,lawyer_id,amount,payment_date,notes,recorded_by)
  values(p_closing,v_closing.lawyer_id,p_amount_cents::numeric / 100,p_date,nullif(trim(p_notes),''),auth.uid())
  returning id into v_id;
  perform private.refresh_closing(p_closing);
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,
    field_name,old_value,new_value,reason)
  values(auth.uid(),v_closing.lawyer_id,'commission_transfers',v_id,'created',null,
    jsonb_build_object('amount',p_amount_cents::numeric / 100,'payment_date',p_date),
    'Repasse registrado');
  return v_id;
end;
$$;
revoke all on function private.register_commission_transfer(uuid,bigint,date,text) from public, anon, authenticated;
create function public.register_commission_transfer(p_closing uuid, p_amount_cents bigint,
  p_date date, p_notes text) returns uuid language sql security invoker set search_path = '' as $$
  select private.register_commission_transfer(p_closing,p_amount_cents,p_date,p_notes);
$$;
revoke all on function public.register_commission_transfer(uuid,bigint,date,text) from public, anon, authenticated;
grant execute on function private.register_commission_transfer(uuid,bigint,date,text),
  public.register_commission_transfer(uuid,bigint,date,text) to authenticated;

create function private.reverse_commission_transfer(p_transfer uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_transfer public.commission_transfers%rowtype;
begin
  if auth.uid() is null or private.current_role() <> 'manager' then raise exception 'Acesso não autorizado'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 or length(p_reason) > 1000 then raise exception 'Motivo obrigatório'; end if;
  select * into v_transfer from public.commission_transfers where id = p_transfer for update;
  if not found or v_transfer.reversed_at is not null then raise exception 'Repasse indisponível'; end if;
  update public.commission_transfers set reversed_at = now(), reversed_by = auth.uid(),
    reversal_reason = trim(p_reason) where id = p_transfer;
  perform private.refresh_closing(v_transfer.closing_id);
  perform private.log_manager_change(v_transfer.lawyer_id,'commission_transfers',p_transfer,
    'reversed_at',jsonb_build_object('amount',v_transfer.amount),
    jsonb_build_object('reversed_at',now()),p_reason);
end;
$$;
revoke all on function private.reverse_commission_transfer(uuid,text) from public, anon, authenticated;
create function public.reverse_commission_transfer(p_transfer uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  select private.reverse_commission_transfer(p_transfer,p_reason);
$$;
revoke all on function public.reverse_commission_transfer(uuid,text) from public, anon, authenticated;
grant execute on function private.reverse_commission_transfer(uuid,text),
  public.reverse_commission_transfer(uuid,text) to authenticated;

create function private.revise_manager_payment(p_payment uuid, p_reason text,
  p_new_amount_cents bigint, p_new_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.payments%rowtype;
  v_old_commission numeric(14,2);
  v_lawyer uuid;
  v_new uuid;
  v_new_commission numeric(14,2) := 0;
begin
  if auth.uid() is null or private.current_role() <> 'manager' then raise exception 'Acesso não autorizado'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 or length(p_reason) > 1000 then raise exception 'Motivo obrigatório'; end if;
  if (p_new_amount_cents is null) <> (p_new_date is null) or
    (p_new_amount_cents is not null and (p_new_amount_cents <= 0 or p_new_amount_cents > 99999999999999)) then
    raise exception 'Informe valor e data válidos, ou ambos vazios para estorno'; end if;
  select * into v_old from public.payments where id = p_payment for update;
  if not found or v_old.voided_at is not null then raise exception 'Pagamento indisponível'; end if;
  select c.lawyer_id, cm.commission_amount into v_lawyer, v_old_commission
  from public.installments i join public.contracts c on c.id = i.contract_id
  join public.commissions cm on cm.payment_id = v_old.id where i.id = v_old.installment_id;
  if v_lawyer is null then raise exception 'Comissão não encontrada'; end if;
  update public.payments set voided_at = now(), voided_by = auth.uid(),
    void_reason = trim(p_reason) where id = p_payment;
  if p_new_amount_cents is not null then
    insert into public.payments(installment_id,payment_date,amount_paid,observation)
    values(v_old.installment_id,p_new_date,p_new_amount_cents::numeric / 100,v_old.observation)
    returning id into v_new;
    update public.payments set replaces_payment_id = p_payment where id = v_new;
    select commission_amount into v_new_commission from public.commissions where payment_id = v_new;
  end if;
  perform private.add_closed_adjustment(v_lawyer,v_old.payment_date,p_payment,
    -v_old.amount_paid,-v_old_commission,p_reason);
  if v_new is not null then
    perform private.add_closed_adjustment(v_lawyer,p_new_date,v_new,
      p_new_amount_cents::numeric / 100,v_new_commission,p_reason);
  end if;
  perform private.log_manager_change(v_lawyer,'payments',p_payment,'payment_state',
    jsonb_build_object('amount_paid',v_old.amount_paid,'payment_date',v_old.payment_date),
    case when v_new is null then jsonb_build_object('status','voided')
      else jsonb_build_object('new_payment_id',v_new,'amount_paid',p_new_amount_cents::numeric / 100,
        'payment_date',p_new_date) end,p_reason);
  return v_new;
end;
$$;
revoke all on function private.revise_manager_payment(uuid,text,bigint,date) from public, anon, authenticated;
create function public.revise_manager_payment(p_payment uuid, p_reason text,
  p_new_amount_cents bigint, p_new_date date) returns uuid language sql security invoker set search_path = '' as $$
  select private.revise_manager_payment(p_payment,p_reason,p_new_amount_cents,p_new_date);
$$;
revoke all on function public.revise_manager_payment(uuid,text,bigint,date) from public, anon, authenticated;
grant execute on function private.revise_manager_payment(uuid,text,bigint,date),
  public.revise_manager_payment(uuid,text,bigint,date) to authenticated;

-- Campos permitidos são fixos; SQL dinâmico recebe apenas identificadores
-- constantes da allowlist. Percentual corrige comissões atuais e compensa
-- meses já fechados, sem tocar os snapshots de monthly_closing_items.
create function private.correct_manager_field(p_table text,p_record uuid,p_field text,
  p_new text,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
  v_new text := trim(p_new);
  v_lawyer uuid;
  v_contract uuid;
  v_payment record;
  v_new_commission numeric(14,2);
  v_client uuid;
begin
  if auth.uid() is null or private.current_role() <> 'manager' then raise exception 'Acesso não autorizado'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 or length(p_reason) > 1000 then raise exception 'Motivo obrigatório'; end if;
  if p_record is null or v_new is null or length(v_new) = 0 then raise exception 'Novo valor obrigatório'; end if;
  if p_table = 'clients' and p_field in ('full_name','cpf') then
    select case when p_field = 'full_name' then full_name else cpf end into v_old
      from public.clients where id = p_record for update;
    if not found then raise exception 'Cliente não encontrado'; end if;
    if p_field = 'full_name' and (length(v_new) < 2 or length(v_new) > 160) then raise exception 'Nome inválido'; end if;
    if p_field = 'cpf' and not private.valid_cpf(v_new) then raise exception 'CPF inválido'; end if;
    if v_old is not distinct from v_new then raise exception 'Novo valor igual ao atual'; end if;
    execute format('update public.clients set %I = $1 where id = $2',p_field) using v_new,p_record;
    for v_lawyer in select distinct lawyer_id from public.contracts where client_id = p_record loop
      perform private.log_manager_change(v_lawyer,p_table,p_record,p_field,to_jsonb(v_old),to_jsonb(v_new),p_reason);
    end loop;
    if not found then perform private.log_manager_change(null,p_table,p_record,p_field,to_jsonb(v_old),to_jsonb(v_new),p_reason); end if;
    return;
  elsif p_table = 'contracts' and p_field in ('origin','contract_date','total_contract_value') then
    select lawyer_id, case p_field when 'origin' then origin when 'contract_date' then contract_date::text
      else total_contract_value::text end into v_lawyer,v_old
      from public.contracts where id = p_record for update;
    if not found then raise exception 'Contrato não encontrado'; end if;
    if p_field = 'origin' and v_new not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP') then raise exception 'Origem inválida'; end if;
    if p_field = 'contract_date' then perform v_new::date; end if;
    if p_field = 'total_contract_value' and (v_new::numeric < 0 or v_new::numeric > 999999999999.99) then raise exception 'Valor inválido'; end if;
    if p_field = 'origin' then
      update public.contracts set origin = v_new where id = p_record;
    elsif p_field = 'contract_date' then
      update public.contracts set contract_date = v_new::date where id = p_record;
    else
      update public.contracts set total_contract_value = v_new::numeric where id = p_record;
    end if;
  elsif p_table = 'installments' and p_field in ('due_date','contractual_amount') then
    select c.lawyer_id, case p_field when 'due_date' then i.due_date::text
      else i.contractual_amount::text end into v_lawyer,v_old
      from public.installments i join public.contracts c on c.id = i.contract_id
      where i.id = p_record for update of i;
    if not found then raise exception 'Parcela não encontrada'; end if;
    if p_field = 'due_date' then perform v_new::date; end if;
    if p_field = 'contractual_amount' and (v_new::numeric < 0 or v_new::numeric > 999999999999.99) then raise exception 'Valor inválido'; end if;
    if p_field = 'due_date' then
      update public.installments set due_date = v_new::date where id = p_record;
    else
      update public.installments set contractual_amount = v_new::numeric where id = p_record;
    end if;
  elsif p_table = 'collection_notes' and p_field in ('content','note_type') then
    select n.contract_id,n.client_id, case when p_field = 'content' then n.content else n.note_type end
      into v_contract,v_client,v_old from public.collection_notes n where n.id = p_record for update;
    if not found then raise exception 'Nota não encontrada'; end if;
    if p_field = 'content' and length(v_new) > 3000 then raise exception 'Texto longo demais'; end if;
    if p_field = 'note_type' and v_new not in ('collection','client_reply','renegotiation','general') then raise exception 'Tipo inválido'; end if;
    if v_old is not distinct from v_new then raise exception 'Novo valor igual ao atual'; end if;
    execute format('update public.collection_notes set %I = $1 where id = $2',p_field)
      using v_new,p_record;
    select lawyer_id into v_lawyer from public.contracts where id = v_contract;
    if v_contract is null then
      for v_lawyer in select distinct lawyer_id from public.contracts where client_id = v_client loop
        perform private.log_manager_change(v_lawyer,p_table,p_record,p_field,to_jsonb(v_old),to_jsonb(v_new),p_reason);
      end loop;
      if not found then perform private.log_manager_change(null,p_table,p_record,p_field,to_jsonb(v_old),to_jsonb(v_new),p_reason); end if;
      return;
    end if;
  elsif p_table = 'contract_financial_terms' and p_field = 'commission_percentage' then
    if v_new::numeric not in (5,10,15,20,25,30,35,40,45,50,55,60) then raise exception 'Percentual inválido'; end if;
    select c.lawyer_id,t.commission_percentage::text into v_lawyer,v_old
      from public.contract_financial_terms t join public.contracts c on c.id = t.contract_id
      where t.contract_id = p_record;
    if not found then raise exception 'Percentual não encontrado'; end if;
    -- Serializa a revisão com o fechamento e os lançamentos de cada mês
    -- afetado; evita comissão atualizada sem ajuste em snapshot simultâneo.
    for v_payment in select distinct hashtext(v_lawyer::text ||
        date_trunc('month',p.payment_date)::date::text) as lock_key
      from public.installments i join public.payments p on p.installment_id = i.id
      where i.contract_id = p_record and p.voided_at is null order by lock_key loop
      perform pg_advisory_xact_lock(v_payment.lock_key::bigint);
    end loop;
    select t.commission_percentage::text into v_old from public.contract_financial_terms t
      where t.contract_id = p_record for update;
    if v_old::numeric = v_new::numeric then raise exception 'Novo valor igual ao atual'; end if;
    update public.contract_financial_terms set commission_percentage = v_new::numeric where contract_id = p_record;
    for v_payment in select p.id,p.payment_date,p.amount_paid,cm.id as commission_id,
        cm.commission_amount as old_commission
      from public.installments i join public.payments p on p.installment_id = i.id
      join public.commissions cm on cm.payment_id = p.id
      where i.contract_id = p_record and p.voided_at is null for update of cm loop
      v_new_commission := round(v_payment.amount_paid * v_new::numeric / 100,2);
      update public.commissions set commission_percentage = v_new::numeric,
        commission_amount = v_new_commission where id = v_payment.commission_id;
      perform private.add_closed_adjustment(v_lawyer,v_payment.payment_date,v_payment.id,
        0,v_new_commission - v_payment.old_commission,p_reason);
      insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,
        field_name,old_value,new_value,reason)
      values(auth.uid(),v_lawyer,'commissions',v_payment.commission_id,'commission_amount',
        to_jsonb(v_payment.old_commission),to_jsonb(v_new_commission),trim(p_reason));
    end loop;
  else
    raise exception 'Campo não permitido para correção';
  end if;
  if v_old is not distinct from v_new then raise exception 'Novo valor igual ao atual'; end if;
  perform private.log_manager_change(v_lawyer,p_table,p_record,p_field,to_jsonb(v_old),to_jsonb(v_new),p_reason);
end;
$$;
revoke all on function private.correct_manager_field(text,uuid,text,text,text) from public, anon, authenticated;
create function public.correct_manager_field(p_table text,p_record uuid,p_field text,
  p_new text,p_reason text) returns void language sql security invoker set search_path = '' as $$
  select private.correct_manager_field(p_table,p_record,p_field,p_new,p_reason);
$$;
revoke all on function public.correct_manager_field(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function private.correct_manager_field(text,uuid,text,text,text),
  public.correct_manager_field(text,uuid,text,text,text) to authenticated;

create function private.admin_update_profile(p_user uuid,p_name text,p_role text,p_active boolean,
  p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.profiles%rowtype;
begin
  if auth.uid() is null or private.current_role() <> 'admin' then raise exception 'Acesso não autorizado'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 or length(p_reason) > 1000 then raise exception 'Motivo obrigatório'; end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(p_name) > 160 or
     p_role not in ('lawyer','secretary','manager','admin') or p_active is null then
    raise exception 'Dados de usuário inválidos'; end if;
  select * into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if p_user = auth.uid() and (not p_active or p_role <> 'admin') then
    raise exception 'Não é possível remover o próprio acesso administrativo'; end if;
  if v_old.role = 'admin' and v_old.active and (p_role <> 'admin' or not p_active)
    and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'O último administrador ativo não pode ser removido'; end if;
  if v_old.role = 'lawyer' and p_role <> 'lawyer' and (exists
    (select 1 from public.contracts where lawyer_id = p_user) or exists
    (select 1 from public.monthly_closings where lawyer_id = p_user)) then
    raise exception 'Advogada com histórico financeiro deve manter o perfil lawyer'; end if;
  update public.profiles set full_name = trim(p_name), role = p_role, active = p_active where id = p_user;
  if v_old.full_name is distinct from trim(p_name) then
    insert into public.audit_logs(user_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),'profiles',p_user,'full_name',to_jsonb(v_old.full_name),to_jsonb(trim(p_name)),trim(p_reason));
  end if;
  if v_old.role is distinct from p_role then
    insert into public.audit_logs(user_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),'profiles',p_user,'role',to_jsonb(v_old.role),to_jsonb(p_role),trim(p_reason));
  end if;
  if v_old.active is distinct from p_active then
    insert into public.audit_logs(user_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),'profiles',p_user,'active',to_jsonb(v_old.active),to_jsonb(p_active),trim(p_reason));
  end if;
end;
$$;
revoke all on function private.admin_update_profile(uuid,text,text,boolean,text) from public, anon, authenticated;
create function public.admin_update_profile(p_user uuid,p_name text,p_role text,p_active boolean,
  p_reason text) returns void language sql security invoker set search_path = '' as $$
  select private.admin_update_profile(p_user,p_name,p_role,p_active,p_reason);
$$;
revoke all on function public.admin_update_profile(uuid,text,text,boolean,text) from public, anon, authenticated;
grant execute on function private.admin_update_profile(uuid,text,text,boolean,text),
  public.admin_update_profile(uuid,text,text,boolean,text) to authenticated;
