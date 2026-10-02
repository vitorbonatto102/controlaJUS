-- Cadastro por PDF ou manual. O PDF continua privado e opcional; contratos com
-- início condicionado ficam sem parcelas até que exista vencimento real.
begin;
alter table public.contracts
  add column if not exists payment_start_type text,
  add column if not exists first_due_date date,
  add column if not exists payment_start_condition text,
  add column if not exists installment_count integer,
  add column if not exists installment_amount numeric(14,2),
  add column if not exists last_installment_amount numeric(14,2),
  add column if not exists has_additional_fee boolean not null default false,
  add column if not exists additional_fee_percentage numeric(5,2),
  add column if not exists additional_fee_basis text,
  add column if not exists additional_fee_amount numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contracts_payment_start_check'
      and conrelid = 'public.contracts'::regclass) then
    alter table public.contracts add constraint contracts_payment_start_check check (
      (payment_start_type is null and first_due_date is null and payment_start_condition is null)
      or (payment_start_type = 'fixed_date' and first_due_date is not null and payment_start_condition is null)
      or (payment_start_type = 'condition' and first_due_date is null and
          payment_start_condition is not null and
          length(trim(payment_start_condition)) between 5 and 500)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_installment_terms_check'
      and conrelid = 'public.contracts'::regclass) then
    alter table public.contracts add constraint contracts_installment_terms_check check (
      (installment_count is null and installment_amount is null and last_installment_amount is null)
      or (installment_count is not null and installment_amount is not null and
          installment_count between 1 and 120 and installment_amount > 0 and
          (last_installment_amount is null or
           (installment_count > 1 and last_installment_amount > 0)))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_additional_fee_check'
      and conrelid = 'public.contracts'::regclass) then
    alter table public.contracts add constraint contracts_additional_fee_check check (
      (has_additional_fee = false and additional_fee_percentage is null and
       additional_fee_basis is null and additional_fee_amount is null)
      or (has_additional_fee = true and
          (additional_fee_percentage is null or additional_fee_percentage between 0.01 and 100) and
          (additional_fee_basis is null or length(trim(additional_fee_basis)) between 2 and 200) and
          (additional_fee_amount is null or additional_fee_amount >= 0))
    );
  end if;
end;
$$;
comment on column public.contracts.additional_fee_percentage is
  'Percentual eventual cobrado do cliente; distinto de contract_financial_terms.commission_percentage.';
comment on column public.contracts.additional_fee_amount is
  'Valor eventual informado manualmente; não entra no principal, parcelas ou comissões.';
comment on column public.contracts.payment_start_condition is
  'Condição textual; não autoriza geração de vencimentos fictícios.';

create or replace function private.create_lawyer_contract_v2(
  p_contract_id uuid, p_client_name text, p_cpf text, p_contract_date date,
  p_total_cents bigint, p_origin text, p_percentage smallint,
  p_payment_method text, p_file_path text, p_file_name text, p_schedule jsonb,
  p_payment_start_type text, p_first_due_date date, p_payment_start_condition text,
  p_installment_count integer, p_installment_cents bigint,
  p_has_additional_fee boolean, p_additional_fee_percentage numeric,
  p_additional_fee_basis text, p_additional_fee_amount_cents bigint,
  p_last_installment_cents bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_client_id uuid;
  v_existing_name text;
  v_item jsonb;
  v_order integer := 0;
  v_regular integer := 0;
  v_entry_count integer := 0;
  v_cents bigint;
  v_sum bigint := 0;
  v_kind text;
  v_regular_number integer;
  v_due date;
  v_entry_due date;
  v_first_regular_due date;
begin
  if v_actor is null or private.current_role() <> 'lawyer' then
    raise exception 'Acesso não autorizado';
  end if;
  if p_contract_id is null or p_client_name is null or
     length(trim(p_client_name)) not between 2 and 160 or
     not private.valid_cpf(p_cpf) or p_contract_date is null or
     p_total_cents is null or p_total_cents <= 0 or p_total_cents > 99999999999999 or
     p_origin not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP') or
     p_percentage not in (5,10,15,20,25,30,35,40,45,50,55,60) or
     p_payment_method not in ('cash','installments') or
     p_installment_count is null or p_installment_count not between 1 and 120 or
     p_installment_cents is null or p_installment_cents <= 0 or
     p_installment_cents > 99999999999999 or
     (p_last_installment_cents is not null and
      (p_payment_method <> 'installments' or p_installment_count < 2 or
       p_last_installment_cents <= 0 or p_last_installment_cents > 99999999999999)) or
     (p_payment_method = 'cash' and p_installment_count <> 1) or
     p_payment_start_type not in ('fixed_date','condition') or
     p_payment_start_type is null or
     p_has_additional_fee is null then
    raise exception 'Dados do contrato inválidos';
  end if;
  if (p_payment_start_type = 'fixed_date' and
      (p_first_due_date is null or p_payment_start_condition is not null)) or
     (p_payment_start_type = 'condition' and
      (p_first_due_date is not null or p_payment_start_condition is null or
       length(trim(p_payment_start_condition)) not between 5 and 500)) then
    raise exception 'Início dos pagamentos inválido';
  end if;
  if (p_has_additional_fee = false and
      (p_additional_fee_percentage is not null or p_additional_fee_basis is not null or
       p_additional_fee_amount_cents is not null)) or
     (p_has_additional_fee = true and
      ((p_additional_fee_percentage is not null and
        (p_additional_fee_percentage <= 0 or p_additional_fee_percentage > 100 or
         p_additional_fee_percentage <> round(p_additional_fee_percentage, 2))) or
       (p_additional_fee_basis is not null and
        length(trim(p_additional_fee_basis)) not between 2 and 200) or
       (p_additional_fee_amount_cents is not null and
        (p_additional_fee_amount_cents < 0 or p_additional_fee_amount_cents > 99999999999999)))) then
    raise exception 'Honorários adicionais inválidos';
  end if;
  if p_file_path is null then
    if p_file_name is not null then raise exception 'Arquivo sem caminho'; end if;
  elsif p_file_name is null or length(trim(p_file_name)) not between 1 and 255 or
        storage.foldername(p_file_path) <> array['contracts', v_actor::text, p_contract_id::text] or
        storage.filename(p_file_path) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' or
        not exists (select 1 from storage.objects o where o.bucket_id = 'contract-pdfs'
          and o.name = p_file_path and o.owner_id = v_actor::text) then
    raise exception 'PDF não encontrado ou sem permissão';
  end if;
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'array' or
     jsonb_array_length(p_schedule) > 121 then
    raise exception 'Cronograma inválido';
  end if;
  if p_payment_start_type = 'condition' then
    if jsonb_array_length(p_schedule) <> 0 or
       p_total_cents <> (p_installment_count::bigint - 1) * p_installment_cents +
         coalesce(p_last_installment_cents, p_installment_cents) then
      raise exception 'Contrato condicionado não deve gerar parcelas ou divergir do valor total';
    end if;
  elsif jsonb_array_length(p_schedule) < 1 then
    raise exception 'Cronograma obrigatório para vencimento definido';
  end if;

  insert into public.clients (full_name, cpf)
  values (trim(p_client_name), p_cpf) on conflict (cpf) do nothing;
  select id, full_name into v_client_id, v_existing_name
    from public.clients where cpf = p_cpf;
  if lower(trim(v_existing_name)) <> lower(trim(p_client_name)) then
    raise exception 'CPF já cadastrado com nome diferente; confirme os dados com o administrador';
  end if;

  insert into public.contracts
    (id, client_id, lawyer_id, origin, total_contract_value, contract_date,
     contract_file_path, contract_file_name, payment_method, payment_start_type,
     first_due_date, payment_start_condition, installment_count, installment_amount,
     last_installment_amount,
     has_additional_fee, additional_fee_percentage, additional_fee_basis, additional_fee_amount)
  values
    (p_contract_id, v_client_id, v_actor, p_origin, p_total_cents::numeric / 100,
     p_contract_date, p_file_path, trim(p_file_name), p_payment_method, p_payment_start_type,
     p_first_due_date, nullif(trim(p_payment_start_condition), ''), p_installment_count,
     p_installment_cents::numeric / 100, p_last_installment_cents::numeric / 100,
     p_has_additional_fee, p_additional_fee_percentage,
     nullif(trim(p_additional_fee_basis), ''), p_additional_fee_amount_cents::numeric / 100);
  insert into public.contract_financial_terms (contract_id, commission_percentage)
    values (p_contract_id, p_percentage);

  for v_item in select value from jsonb_array_elements(p_schedule) loop
    v_order := v_order + 1;
    v_cents := (v_item ->> 'amount_cents')::bigint;
    v_due := (v_item ->> 'due_date')::date;
    v_kind := v_item ->> 'kind';
    v_regular_number := (v_item ->> 'regular_number')::integer;
    if v_cents is null or v_cents <= 0 or v_due is null or
       (v_item ->> 'installment_number')::integer <> v_order or
       v_kind not in ('down_payment','regular') then
      raise exception 'Item inválido no cronograma';
    end if;
    if v_kind = 'down_payment' then
      v_entry_count := v_entry_count + 1;
      v_entry_due := v_due;
      if v_order <> 1 or v_entry_count > 1 or v_regular_number is not null or
         p_payment_method <> 'installments' then
        raise exception 'Entrada inválida';
      end if;
    else
      v_regular := v_regular + 1;
      if v_regular_number is distinct from v_regular or
         (p_payment_method = 'installments' and v_cents <>
           case when v_regular = p_installment_count then
             coalesce(p_last_installment_cents, p_installment_cents)
           else p_installment_cents end) or
         (p_payment_method = 'cash' and v_cents <> p_total_cents) then
        raise exception 'Valor ou ordem das parcelas inválidos';
      end if;
      if v_regular = 1 then
        v_first_regular_due := v_due;
        if v_due <> p_first_due_date or
           (v_entry_due is not null and v_entry_due > v_due) then
          raise exception 'Primeiro vencimento inválido';
        end if;
      elsif v_due <> private.add_months_clamped(v_first_regular_due, v_regular - 1) then
        raise exception 'Vencimentos mensais inválidos';
      end if;
    end if;
    v_sum := v_sum + v_cents;
    if v_sum > 99999999999999 then raise exception 'Cronograma excede o limite'; end if;
    insert into public.installments
      (contract_id, installment_number, kind, regular_number, due_date, contractual_amount)
    values (p_contract_id, v_order, v_kind, v_regular_number, v_due, v_cents::numeric / 100);
  end loop;
  if p_payment_start_type = 'fixed_date' and
     (v_sum <> p_total_cents or v_regular <> p_installment_count) then
    raise exception 'Total do cronograma diverge do contrato';
  end if;
  return p_contract_id;
end;
$$;
revoke all on function private.create_lawyer_contract_v2(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint)
  from public, anon, authenticated;
grant execute on function private.create_lawyer_contract_v2(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint)
  to authenticated;

create or replace function public.create_lawyer_contract_v2(
  p_contract_id uuid, p_client_name text, p_cpf text, p_contract_date date,
  p_total_cents bigint, p_origin text, p_percentage smallint,
  p_payment_method text, p_file_path text, p_file_name text, p_schedule jsonb,
  p_payment_start_type text, p_first_due_date date, p_payment_start_condition text,
  p_installment_count integer, p_installment_cents bigint,
  p_has_additional_fee boolean, p_additional_fee_percentage numeric,
  p_additional_fee_basis text, p_additional_fee_amount_cents bigint,
  p_last_installment_cents bigint
) returns uuid language sql security invoker set search_path = '' as $$
  select private.create_lawyer_contract_v2(
    p_contract_id, p_client_name, p_cpf, p_contract_date, p_total_cents,
    p_origin, p_percentage, p_payment_method, p_file_path, p_file_name,
    p_schedule, p_payment_start_type, p_first_due_date, p_payment_start_condition,
    p_installment_count, p_installment_cents, p_has_additional_fee,
    p_additional_fee_percentage, p_additional_fee_basis, p_additional_fee_amount_cents,
    p_last_installment_cents
  );
$$;
revoke all on function public.create_lawyer_contract_v2(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.create_lawyer_contract_v2(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint)
  to authenticated;
commit;
