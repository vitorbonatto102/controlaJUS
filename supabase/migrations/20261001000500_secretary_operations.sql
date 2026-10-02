-- Etapa 3: histórico operacional e correção auditável da própria secretaria.
-- O registro original e sua comissão permanecem para auditoria; relatórios
-- devem considerar somente pagamentos com voided_at IS NULL.
alter table public.payments
  add column observation text check (observation is null or length(observation) <= 1000),
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id),
  add column void_reason text,
  add column replaces_payment_id uuid references public.payments(id),
  add constraint payments_void_consistency check (
    (voided_at is null and voided_by is null and void_reason is null) or
    (voided_at is not null and voided_by is not null and void_reason is not null
      and length(trim(void_reason)) > 0)
  );
create index payments_active_installment_date on public.payments (installment_id, payment_date)
  where voided_at is null;

alter table public.collection_notes
  add column installment_id uuid references public.installments(id);
create index collection_notes_installment_time on public.collection_notes (installment_id, created_at desc);

-- Um chamador autenticado não pode criar pagamento já estornado nem forjar
-- substituição. A RPC privilegiada marca replaces_payment_id após o INSERT.
create or replace function public.set_actor() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_table_name = 'payments' then
    new.recorded_by := auth.uid();
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.replaces_payment_id := null;
  elsif tg_table_name = 'collection_notes' then
    new.author_id := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.ensure_note_contract_client() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.contract_id is not null and not exists (
    select 1 from public.contracts c where c.id = new.contract_id and c.client_id = new.client_id
  ) then
    raise exception 'Contrato não pertence ao cliente informado';
  end if;
  if new.installment_id is not null and (new.contract_id is null or not exists (
    select 1 from public.installments i where i.id = new.installment_id and i.contract_id = new.contract_id
  )) then
    raise exception 'Parcela não pertence ao contrato informado';
  end if;
  return new;
end;
$$;

create function private.revise_secretary_payment(
  p_payment_id uuid, p_reason text, p_new_amount_cents bigint, p_new_date date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_lawyer uuid;
  v_new_id uuid;
begin
  if v_actor is null or private.current_role() <> 'secretary' then
    raise exception 'Acesso não autorizado';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 or length(p_reason) > 1000 then
    raise exception 'Informe o motivo da correção (5 a 1000 caracteres)';
  end if;
  if (p_new_amount_cents is null) <> (p_new_date is null) then
    raise exception 'Informe valor e data para substituir, ou ambos vazios para estornar';
  end if;
  if p_new_amount_cents is not null and (p_new_amount_cents <= 0 or p_new_amount_cents > 99999999999999) then
    raise exception 'Valor inválido';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.voided_at is not null or v_payment.recorded_by <> v_actor then
    raise exception 'Pagamento indisponível para correção';
  end if;
  select c.lawyer_id into v_lawyer from public.installments i
    join public.contracts c on c.id = i.contract_id where i.id = v_payment.installment_id;
  if exists (
    select 1 from public.monthly_closings mc
    where mc.lawyer_id = v_lawyer and mc.reference_year = extract(year from v_payment.payment_date)
      and mc.reference_month = extract(month from v_payment.payment_date) and mc.status <> 'draft'
  ) then
    raise exception 'Pagamento de período já fechado requer correção pelo gestor';
  end if;
  if p_new_date is not null and exists (
    select 1 from public.monthly_closings mc
    where mc.lawyer_id = v_lawyer and mc.reference_year = extract(year from p_new_date)
      and mc.reference_month = extract(month from p_new_date) and mc.status <> 'draft'
  ) then
    raise exception 'Nova data pertence a período já fechado';
  end if;

  update public.payments set voided_at = now(), voided_by = v_actor,
    void_reason = trim(p_reason) where id = p_payment_id;
  if p_new_amount_cents is not null then
    insert into public.payments (installment_id, payment_date, amount_paid, observation)
    values (v_payment.installment_id, p_new_date, p_new_amount_cents::numeric / 100,
      v_payment.observation)
    returning id into v_new_id;
    update public.payments set replaces_payment_id = p_payment_id where id = v_new_id;
  end if;

  insert into public.audit_logs
    (user_id, affected_lawyer_id, table_name, record_id, field_name, old_value, new_value, reason)
  values (v_actor, v_lawyer, 'payments', p_payment_id, 'payment_state',
    jsonb_build_object('payment_date', v_payment.payment_date, 'amount_paid', v_payment.amount_paid,
      'observation', v_payment.observation),
    case when v_new_id is null then jsonb_build_object('status', 'voided')
      else jsonb_build_object('status', 'replaced', 'new_payment_id', v_new_id,
        'payment_date', p_new_date, 'amount_paid', p_new_amount_cents::numeric / 100) end,
    trim(p_reason));
  return v_new_id;
end;
$$;
revoke all on function private.revise_secretary_payment(uuid,text,bigint,date) from public, anon, authenticated;
grant execute on function private.revise_secretary_payment(uuid,text,bigint,date) to authenticated;

create function public.revise_secretary_payment(
  p_payment_id uuid, p_reason text, p_new_amount_cents bigint, p_new_date date
) returns uuid language sql security invoker set search_path = '' as $$
  select private.revise_secretary_payment(p_payment_id, p_reason, p_new_amount_cents, p_new_date);
$$;
revoke all on function public.revise_secretary_payment(uuid,text,bigint,date) from public, anon, authenticated;
grant execute on function public.revise_secretary_payment(uuid,text,bigint,date) to authenticated;
