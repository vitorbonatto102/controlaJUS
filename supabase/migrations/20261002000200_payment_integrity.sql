-- Etapa 4: impede lançamentos retroativos silenciosos em meses fechados.
-- A secretaria continua registrando pagamentos de meses ainda abertos.

drop policy payments_insert on public.payments;
create policy payments_insert on public.payments for insert to authenticated
  with check ((select private.current_role()) = 'secretary'
    and recorded_by = (select auth.uid()));

create function private.guard_closed_month_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lawyer uuid;
begin
  select c.lawyer_id into v_lawyer from public.installments i
    join public.contracts c on c.id = i.contract_id where i.id = new.installment_id;
  perform pg_advisory_xact_lock(hashtext(v_lawyer::text ||
    date_trunc('month',new.payment_date)::date::text));
  if exists (select 1 from public.monthly_closings mc
    where mc.lawyer_id = v_lawyer and mc.reference_year = extract(year from new.payment_date)
      and mc.reference_month = extract(month from new.payment_date) and mc.status <> 'draft')
    and not (private.current_role() = 'manager' and
      current_setting('app.manager_payment_correction', true) = 'on') then
    raise exception 'Período já fechado: solicite lançamento complementar ao gestor';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_closed_month_payment() from public, anon, authenticated;
create trigger payments_guard_closed_month before insert on public.payments
  for each row execute function private.guard_closed_month_payment();

create function private.guard_closed_month_void() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lawyer uuid;
begin
  if old.voided_at is not null or new.voided_at is null then return new; end if;
  select c.lawyer_id into v_lawyer from public.installments i
    join public.contracts c on c.id = i.contract_id where i.id = old.installment_id;
  perform pg_advisory_xact_lock(hashtext(v_lawyer::text ||
    date_trunc('month',old.payment_date)::date::text));
  if exists (select 1 from public.monthly_closings mc
    where mc.lawyer_id = v_lawyer and mc.reference_year = extract(year from old.payment_date)
      and mc.reference_month = extract(month from old.payment_date) and mc.status <> 'draft')
    and not (private.current_role() = 'manager' and
      current_setting('app.manager_payment_correction', true) = 'on') then
    raise exception 'Período já fechado: correção exclusiva do gestor';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_closed_month_void() from public, anon, authenticated;
create trigger payments_guard_closed_void before update of voided_at on public.payments
  for each row execute function private.guard_closed_month_void();

-- Lançamentos de criação também entram no histórico, independentemente da UI.
create function private.audit_payment_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lawyer uuid;
begin
  if private.current_role() = 'manager' and
    current_setting('app.manager_payment_correction', true) = 'on' then return new; end if;
  select c.lawyer_id into v_lawyer from public.installments i
    join public.contracts c on c.id = i.contract_id where i.id = new.installment_id;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,
    field_name,old_value,new_value,reason)
  values(auth.uid(),v_lawyer,'payments',new.id,'created',null,
    jsonb_build_object('amount_paid',new.amount_paid,'payment_date',new.payment_date),
    'Pagamento registrado');
  return new;
end;
$$;
revoke all on function private.audit_payment_creation() from public, anon, authenticated;
create trigger payments_audit_creation after insert on public.payments
  for each row execute function private.audit_payment_creation();

create or replace function private.revise_manager_payment(p_payment uuid, p_reason text,
  p_new_amount_cents bigint, p_new_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.payments%rowtype;
  v_old_commission numeric(14,2);
  v_lawyer uuid;
  v_new uuid;
  v_new_commission numeric(14,2) := 0;
  v_old_lock integer;
  v_new_lock integer;
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
  v_old_lock := hashtext(v_lawyer::text || date_trunc('month',v_old.payment_date)::date::text);
  v_new_lock := case when p_new_date is null then v_old_lock else
    hashtext(v_lawyer::text || date_trunc('month',p_new_date)::date::text) end;
  perform pg_advisory_xact_lock(least(v_old_lock,v_new_lock)::bigint);
  if v_old_lock <> v_new_lock then
    perform pg_advisory_xact_lock(greatest(v_old_lock,v_new_lock)::bigint);
  end if;
  perform set_config('app.manager_payment_correction','on',true);
  update public.payments set voided_at = now(), voided_by = auth.uid(),
    void_reason = trim(p_reason) where id = p_payment;
  if p_new_amount_cents is not null then
    insert into public.payments(installment_id,payment_date,amount_paid,observation)
    values(v_old.installment_id,p_new_date,p_new_amount_cents::numeric / 100,v_old.observation)
    returning id into v_new;
    update public.payments set replaces_payment_id = p_payment where id = v_new;
    select commission_amount into v_new_commission from public.commissions where payment_id = v_new;
  end if;
  perform set_config('app.manager_payment_correction','off',true);
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

-- Lançamento complementar quando a data real pertence a um mês já fechado.
create function private.manager_record_payment(p_installment uuid,p_date date,
  p_amount_cents bigint,p_observation text,p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_lawyer uuid; v_payment uuid; v_commission numeric(14,2);
begin
  if auth.uid() is null or private.current_role() <> 'manager' then raise exception 'Acesso não autorizado'; end if;
  if p_date is null or p_amount_cents is null or p_amount_cents <= 0 or
    p_amount_cents > 99999999999999 or length(coalesce(p_observation,'')) > 1000 or
    length(trim(coalesce(p_reason,''))) < 5 or length(p_reason) > 1000 then
    raise exception 'Dados do lançamento complementar inválidos'; end if;
  select c.lawyer_id into v_lawyer from public.installments i
    join public.contracts c on c.id = i.contract_id where i.id = p_installment;
  if v_lawyer is null then raise exception 'Parcela não encontrada'; end if;
  perform set_config('app.manager_payment_correction','on',true);
  insert into public.payments(installment_id,payment_date,amount_paid,observation)
  values(p_installment,p_date,p_amount_cents::numeric / 100,nullif(trim(p_observation),''))
  returning id into v_payment;
  perform set_config('app.manager_payment_correction','off',true);
  select commission_amount into v_commission from public.commissions where payment_id = v_payment;
  perform private.add_closed_adjustment(v_lawyer,p_date,v_payment,
    p_amount_cents::numeric / 100,v_commission,p_reason);
  perform private.log_manager_change(v_lawyer,'payments',v_payment,'created',null,
    jsonb_build_object('amount_paid',p_amount_cents::numeric / 100,'payment_date',p_date),p_reason);
  return v_payment;
end;
$$;
revoke all on function private.manager_record_payment(uuid,date,bigint,text,text) from public, anon, authenticated;
create function public.manager_record_payment(p_installment uuid,p_date date,
  p_amount_cents bigint,p_observation text,p_reason text) returns uuid
language sql security invoker set search_path = '' as $$
  select private.manager_record_payment(p_installment,p_date,p_amount_cents,p_observation,p_reason);
$$;
revoke all on function public.manager_record_payment(uuid,date,bigint,text,text) from public, anon, authenticated;
grant execute on function private.manager_record_payment(uuid,date,bigint,text,text),
  public.manager_record_payment(uuid,date,bigint,text,text) to authenticated;

create function private.audit_contract_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,
    field_name,old_value,new_value,reason)
  values(auth.uid(),new.lawyer_id,'contracts',new.id,'created',null,
    jsonb_build_object('client_id',new.client_id,'total_contract_value',new.total_contract_value),
    'Contrato cadastrado');
  return new;
end;
$$;
revoke all on function private.audit_contract_creation() from public, anon, authenticated;
create trigger contracts_audit_creation after insert on public.contracts
  for each row execute function private.audit_contract_creation();

create function private.audit_note_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lawyer uuid;
begin
  if auth.uid() is null then return new; end if;
  if new.contract_id is not null then
    select lawyer_id into v_lawyer from public.contracts where id = new.contract_id;
  end if;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,
    field_name,old_value,new_value,reason)
  values(auth.uid(),v_lawyer,'collection_notes',new.id,'created',null,
    jsonb_build_object('note_type',new.note_type,'contract_id',new.contract_id),
    'Anotação registrada');
  return new;
end;
$$;
revoke all on function private.audit_note_creation() from public, anon, authenticated;
create trigger notes_audit_creation after insert on public.collection_notes
  for each row execute function private.audit_note_creation();
