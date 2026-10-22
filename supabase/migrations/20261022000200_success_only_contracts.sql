-- Honorários devidos somente no êxito: percentual do cliente, sem principal,
-- cronograma ou cobrança antes de existir resultado e valor conhecido.
begin;

alter table public.contracts add column if not exists success_fee_percentage numeric(5,2);
alter table public.contracts alter column total_contract_value drop not null;
alter table public.contracts drop constraint if exists contracts_payment_method_check;
alter table public.contracts add constraint contracts_payment_method_check
  check (payment_method in ('cash', 'installments', 'success_only'));
alter table public.contracts drop constraint if exists contracts_success_terms_check;
alter table public.contracts add constraint contracts_success_terms_check check (
  (payment_method = 'success_only' and total_contract_value is null
    and success_fee_percentage is not null and success_fee_percentage > 0 and success_fee_percentage <= 100
    and payment_start_type is null and first_due_date is null and payment_start_condition is null
    and installment_count is null and installment_amount is null and last_installment_amount is null
    and has_additional_fee = false)
  or (payment_method is distinct from 'success_only' and total_contract_value is not null
    and success_fee_percentage is null)
);
comment on column public.contracts.success_fee_percentage is
  'Honorários cobrados do cliente no êxito. Não é a participação interna da advogada.';
comment on column public.contracts.total_contract_value is
  'Principal conhecido. NULL apenas para contratos exclusivamente no êxito; não equivale a zero.';

create or replace function private.guard_success_installment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_method text;
begin
  -- Serializa com mudanças no contrato para impedir parcelas concorrentes.
  select payment_method into v_method from public.contracts where id = new.contract_id for share;
  if v_method = 'success_only' then
    raise exception 'Contrato apenas no êxito não possui valor e vencimentos definidos';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_success_installment() from public, anon, authenticated;
drop trigger if exists installments_success_guard on public.installments;
create trigger installments_success_guard before insert or update on public.installments
  for each row execute function private.guard_success_installment();

create or replace function private.guard_success_contract() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_method = 'success_only' and exists (
    select 1 from public.installments where contract_id = new.id
  ) then raise exception 'Contrato com parcelas não pode ser convertido para apenas no êxito'; end if;
  return new;
end;
$$;
revoke all on function private.guard_success_contract() from public, anon, authenticated;
drop trigger if exists contracts_success_guard on public.contracts;
create trigger contracts_success_guard before insert or update on public.contracts
  for each row execute function private.guard_success_contract();

create or replace function private.create_success_contract(
  p_contract_id uuid, p_client_name text, p_cpf text, p_contract_date date,
  p_origin text, p_percentage smallint, p_success_fee_percentage numeric,
  p_file_path text, p_file_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_office uuid := private.current_office_id();
  v_client uuid;
  v_existing_name text;
begin
  if v_actor is null or v_office is null or private.current_role() is distinct from 'lawyer' then
    raise exception 'Acesso não autorizado';
  end if;
  if p_contract_id is null or p_client_name is null or length(trim(p_client_name)) not between 2 and 160
    or p_cpf is null or not private.valid_cpf(p_cpf) or p_contract_date is null
    or p_origin is null or p_origin not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP')
    or p_percentage is null or p_percentage not in (5,10,15,20,25,30,35,40,45,50,55,60)
    or p_success_fee_percentage is null or p_success_fee_percentage <= 0 or p_success_fee_percentage > 100
    or p_success_fee_percentage <> round(p_success_fee_percentage, 2) then
    raise exception 'Confira os dados e o percentual cobrado do cliente no êxito';
  end if;
  if p_file_path is null then
    if p_file_name is not null then raise exception 'Arquivo sem caminho'; end if;
  elsif p_file_name is null or length(trim(p_file_name)) not between 1 and 255
    or storage.foldername(p_file_path) <> array['contracts', v_actor::text, p_contract_id::text]
    or storage.filename(p_file_path) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    or not exists (select 1 from storage.objects where bucket_id = 'contract-pdfs'
      and name = p_file_path and owner_id = v_actor::text) then
    raise exception 'PDF não encontrado ou sem permissão';
  end if;
  insert into public.clients(full_name, cpf, office_id)
    values (trim(p_client_name), p_cpf, v_office)
    on conflict (office_id, cpf) where cpf is not null do nothing;
  select id, full_name into v_client, v_existing_name from public.clients
    where office_id = v_office and cpf = p_cpf;
  if lower(trim(v_existing_name)) <> lower(trim(p_client_name)) then
    raise exception 'CPF já cadastrado com nome diferente; confirme os dados com o administrador';
  end if;
  insert into public.contracts(id, office_id, client_id, lawyer_id, origin, contract_date,
    total_contract_value, payment_method, success_fee_percentage, contract_file_path, contract_file_name)
    values (p_contract_id, v_office, v_client, v_actor, p_origin, p_contract_date,
      null, 'success_only', p_success_fee_percentage, p_file_path, trim(p_file_name));
  insert into public.contract_financial_terms(contract_id, commission_percentage)
    values (p_contract_id, p_percentage);
  return p_contract_id;
end;
$$;
revoke all on function private.create_success_contract(uuid,text,text,date,text,smallint,numeric,text,text)
  from public, anon, authenticated;
grant execute on function private.create_success_contract(uuid,text,text,date,text,smallint,numeric,text,text)
  to authenticated;

create or replace function public.create_success_contract(
  p_contract_id uuid, p_client_name text, p_cpf text, p_contract_date date,
  p_origin text, p_percentage smallint, p_success_fee_percentage numeric,
  p_file_path text, p_file_name text
) returns uuid language sql security invoker set search_path = '' as $$
  select private.create_success_contract(p_contract_id, p_client_name, p_cpf, p_contract_date,
    p_origin, p_percentage, p_success_fee_percentage, p_file_path, p_file_name);
$$;
revoke all on function public.create_success_contract(uuid,text,text,date,text,smallint,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.create_success_contract(uuid,text,text,date,text,smallint,numeric,text,text)
  to authenticated;

create index if not exists contracts_follow_up on public.contracts(office_id, lawyer_id, contract_date desc)
  where payment_method = 'success_only' or has_additional_fee or payment_start_type = 'condition';
commit;
