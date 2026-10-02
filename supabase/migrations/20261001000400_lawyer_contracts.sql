-- Etapa 2: cadastro atômico pela advogada, cronograma, PDF privado e comissão
-- gerada sobre pagamentos reais. As migrations anteriores permanecem intactas.

-- Corrige a referência ao cliente externo na política da etapa 1. O `id`
-- não qualificado era resolvido para contracts.id dentro da subconsulta.
drop policy clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using (
    (select private.current_role()) in ('secretary','manager','admin')
    or ((select private.current_role()) = 'lawyer' and exists (
      select 1 from public.contracts c
      where c.client_id = clients.id and c.lawyer_id = (select auth.uid())
    ))
  );

alter table public.contracts
  add column payment_method text check (payment_method in ('cash', 'installments')),
  add column contract_file_name text;

alter table public.installments
  add column kind text not null default 'regular'
    check (kind in ('down_payment', 'regular')),
  add column regular_number integer check (regular_number is null or regular_number > 0);

update public.installments set regular_number = installment_number
where regular_number is null;

alter table public.installments add constraint installments_kind_number_check
  check ((kind = 'down_payment' and regular_number is null)
      or (kind = 'regular' and regular_number is not null));
create unique index installments_regular_number_unique
  on public.installments (contract_id, regular_number) where kind = 'regular';

update storage.buckets
set public = false, file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf']
where id = 'contract-pdfs';

-- Upload com UUID aleatório antes da confirmação. O arquivo só se torna um
-- documento contratual depois que a função transacional grava seu caminho.
create policy contract_pdf_lawyer_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'contract-pdfs'
    and (select private.current_role()) = 'lawyer'
    and owner_id = (select auth.uid())::text
    and storage.foldername(name) = array['contracts', (select auth.uid())::text,
      (storage.foldername(name))[3]]
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  );

create policy contract_pdf_read on storage.objects
  for select to authenticated using (
    bucket_id = 'contract-pdfs' and (
      ((select private.current_role()) = 'lawyer' and
       (storage.foldername(name))[2] = (select auth.uid())::text and
       (owner_id = (select auth.uid())::text or exists (
         select 1 from public.contracts c
         where c.contract_file_path = name and c.lawyer_id = (select auth.uid())
       )))
      or ((select private.current_role()) in ('secretary','manager','admin') and exists (
        select 1 from public.contracts c where c.contract_file_path = name
      ))
    )
  );

-- Só permite limpar upload não vinculado, nunca apagar um PDF de contrato.
create policy contract_pdf_cleanup on storage.objects
  for delete to authenticated using (
    bucket_id = 'contract-pdfs'
    and (select private.current_role()) = 'lawyer'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and not exists (select 1 from public.contracts c where c.contract_file_path = name)
  );

-- CPF numérico, com dígitos verificadores; não trata CPF como chave de acesso.
create function private.valid_cpf(p_cpf text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_sum integer := 0;
  v_digit integer;
  v_i integer;
begin
  if p_cpf is null or p_cpf !~ '^[0-9]{11}$' or p_cpf ~ '^([0-9])\1{10}$' then
    return false;
  end if;
  for v_i in 1..9 loop
    v_sum := v_sum + substr(p_cpf, v_i, 1)::integer * (11 - v_i);
  end loop;
  v_digit := (v_sum * 10) % 11;
  if v_digit = 10 then v_digit := 0; end if;
  if v_digit <> substr(p_cpf, 10, 1)::integer then return false; end if;
  v_sum := 0;
  for v_i in 1..10 loop
    v_sum := v_sum + substr(p_cpf, v_i, 1)::integer * (12 - v_i);
  end loop;
  v_digit := (v_sum * 10) % 11;
  if v_digit = 10 then v_digit := 0; end if;
  return v_digit = substr(p_cpf, 11, 1)::integer;
end;
$$;
revoke all on function private.valid_cpf(text) from public, anon, authenticated;

-- Preserva o dia âncora (31/01, 28/02, 31/03), inclusive em anos bissextos.
create function private.add_months_clamped(p_date date, p_offset integer) returns date
language plpgsql immutable set search_path = '' as $$
declare
  v_month date;
  v_last date;
begin
  v_month := (date_trunc('month', p_date)::date + make_interval(months => p_offset))::date;
  v_last := (v_month + interval '1 month - 1 day')::date;
  return v_month + (least(extract(day from p_date)::integer,
                         extract(day from v_last)::integer) - 1);
end;
$$;
revoke all on function private.add_months_clamped(date,integer) from public, anon, authenticated;

create function private.create_lawyer_contract(
  p_contract_id uuid,
  p_client_name text,
  p_cpf text,
  p_contract_date date,
  p_total_cents bigint,
  p_origin text,
  p_percentage smallint,
  p_payment_method text,
  p_file_path text,
  p_file_name text,
  p_schedule jsonb
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
     length(trim(p_client_name)) < 2 or length(trim(p_client_name)) > 160 or
     not private.valid_cpf(p_cpf) or p_contract_date is null or
     p_total_cents is null or p_total_cents <= 0 or p_total_cents > 99999999999999 or
     p_origin not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP') or
     p_percentage not in (5,10,15,20,25,30,35,40,45,50,55,60) or
     p_payment_method not in ('cash','installments') or
     p_file_name is null or length(trim(p_file_name)) < 1 or length(p_file_name) > 255 then
    raise exception 'Dados do contrato inválidos';
  end if;
  if p_file_path is null or
     storage.foldername(p_file_path) <> array['contracts', v_actor::text, p_contract_id::text] or
     storage.filename(p_file_path) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' or
     not exists (select 1 from storage.objects o
       where o.bucket_id = 'contract-pdfs' and o.name = p_file_path
         and o.owner_id = v_actor::text) then
    raise exception 'PDF não encontrado ou sem permissão';
  end if;
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'array' or
     jsonb_array_length(p_schedule) < 1 or jsonb_array_length(p_schedule) > 121 then
    raise exception 'Cronograma inválido';
  end if;

  -- A unicidade do CPF resolve concorrência entre cadastros. Outro contrato
  -- pode usar o mesmo cliente, sem abrir a leitura dos contratos existentes.
  insert into public.clients (full_name, cpf)
  values (trim(p_client_name), p_cpf)
  on conflict (cpf) do nothing;
  select id, full_name into v_client_id, v_existing_name from public.clients where cpf = p_cpf;
  if lower(trim(v_existing_name)) <> lower(trim(p_client_name)) then
    raise exception 'CPF já cadastrado com nome diferente; confirme os dados com o administrador';
  end if;

  insert into public.contracts
    (id, client_id, lawyer_id, origin, total_contract_value, contract_date,
     contract_file_path, contract_file_name, payment_method)
  values
    (p_contract_id, v_client_id, v_actor, p_origin, p_total_cents::numeric / 100,
     p_contract_date, p_file_path, trim(p_file_name), p_payment_method);
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
      if v_regular_number is distinct from v_regular then
        raise exception 'Ordem das parcelas inválida';
      end if;
      if v_regular = 1 then
        v_first_regular_due := v_due;
        if v_entry_due is not null and v_entry_due > v_due then
          raise exception 'A entrada deve vencer antes da primeira parcela';
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
  if v_sum <> p_total_cents or
     (p_payment_method = 'cash' and (v_order <> 1 or v_regular <> 1)) or
     (p_payment_method = 'installments' and v_regular < 1) then
    raise exception 'Total do cronograma diverge do contrato';
  end if;
  return p_contract_id;
end;
$$;
revoke all on function private.create_lawyer_contract(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function private.create_lawyer_contract(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb)
  to authenticated;

-- Wrapper invocador exposto ao PostgREST; a função privilegiada permanece em
-- schema privado e valida identidade, papel, PDF e valores no banco.
create function public.create_lawyer_contract(
  p_contract_id uuid, p_client_name text, p_cpf text, p_contract_date date,
  p_total_cents bigint, p_origin text, p_percentage smallint,
  p_payment_method text, p_file_path text, p_file_name text, p_schedule jsonb
) returns uuid language sql security invoker set search_path = '' as $$
  select private.create_lawyer_contract(
    p_contract_id, p_client_name, p_cpf, p_contract_date, p_total_cents,
    p_origin, p_percentage, p_payment_method, p_file_path, p_file_name, p_schedule
  );
$$;
revoke all on function public.create_lawyer_contract(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_lawyer_contract(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb)
  to authenticated;

-- Cada pagamento produz uma comissão imutável calculada sobre amount_paid.
-- Não concede escrita na tabela de comissões aos usuários comuns.
create function private.create_payment_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lawyer uuid;
  v_percentage numeric(5,2);
begin
  select c.lawyer_id, t.commission_percentage
  into v_lawyer, v_percentage
  from public.installments i
  join public.contracts c on c.id = i.contract_id
  join public.contract_financial_terms t on t.contract_id = c.id
  where i.id = new.installment_id;
  if v_lawyer is null or v_percentage is null then
    raise exception 'Contrato sem percentual de participação';
  end if;
  insert into public.commissions
    (payment_id, lawyer_id, commission_percentage, commission_amount)
  values (new.id, v_lawyer, v_percentage,
          round(new.amount_paid * v_percentage / 100, 2));
  return new;
end;
$$;
revoke all on function private.create_payment_commission() from public, anon, authenticated;
create trigger payment_generates_commission after insert on public.payments
  for each row execute function private.create_payment_commission();

-- Pagamentos anteriores à migration recebem snapshot quando há percentual.
insert into public.commissions
  (payment_id, lawyer_id, commission_percentage, commission_amount)
select p.id, c.lawyer_id, t.commission_percentage,
       round(p.amount_paid * t.commission_percentage / 100, 2)
from public.payments p
join public.installments i on i.id = p.installment_id
join public.contracts c on c.id = i.contract_id
join public.contract_financial_terms t on t.contract_id = c.id
where not exists (select 1 from public.commissions co where co.payment_id = p.id);
