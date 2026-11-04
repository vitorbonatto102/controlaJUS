-- Grupos consecutivos de parcelas, com valores distintos e cronograma mensal.
-- Mantém RLS, limites, autoria, auditoria e bloqueio de edição com histórico.
begin;
alter table public.contracts add column if not exists installment_groups jsonb not null default '[]';
grant select(installment_groups) on public.contracts to authenticated;
alter table public.contracts drop constraint if exists contracts_installment_groups;
alter table public.contracts add constraint contracts_installment_groups check(
  jsonb_typeof(installment_groups)='array' and jsonb_array_length(installment_groups)<=120
  and (payment_method='installments' or installment_groups='[]'::jsonb));
comment on column public.contracts.installment_groups is 'Grupos ordenados {count,amount_cents}; [] mantém a forma uniforme anterior. A última parcela opcional ajusta somente o último item.';

create or replace function private.installment_group_amounts(p_count integer,p_first bigint,p_groups jsonb,p_last bigint)
returns bigint[] language plpgsql immutable set search_path='' as $$
declare g jsonb;v_count integer;v_amount bigint;v_result bigint[]:='{}';
begin
  if p_count is null or p_count not between 1 and 120 or p_first is null or p_first not between 1 and 99999999999999
    or p_groups is null or jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)>120 then
    raise exception 'Confira a quantidade e o valor dos grupos (até 120 parcelas no total)';end if;
  if p_groups='[]'::jsonb then v_result:=array_fill(p_first,array[p_count]);
  else
    for g in select value from jsonb_array_elements(p_groups) loop
      if jsonb_typeof(g) is distinct from 'object' or jsonb_typeof(g->'count') is distinct from 'number'
        or jsonb_typeof(g->'amount_cents') is distinct from 'number'
        or (g->>'count')::numeric not between 1 and 120 or (g->>'count')::numeric<>trunc((g->>'count')::numeric)
        or (g->>'amount_cents')::numeric not between 1 and 99999999999999
        or (g->>'amount_cents')::numeric<>trunc((g->>'amount_cents')::numeric) then raise exception 'Grupo de parcelas inválido';end if;
      v_count:=(g->>'count')::integer;v_amount:=(g->>'amount_cents')::bigint;
      if cardinality(v_result)+v_count>120 then raise exception 'O cronograma permite até 120 parcelas no total';end if;
      v_result:=v_result||array_fill(v_amount,array[v_count]);
    end loop;
    if cardinality(v_result)<>p_count or v_result[1]<>p_first then raise exception 'Os grupos divergem da quantidade ou do valor inicial das parcelas';end if;
  end if;
  if p_last is not null then
    if p_count<2 or p_last not between 1 and 99999999999999 then raise exception 'Valor da última parcela inválido';end if;
    v_result[p_count]:=p_last;
  end if;
  if (select sum(v) from unnest(v_result) v)>99999999999999 then raise exception 'Cronograma excede o limite';end if;
  return v_result;
end $$;
revoke all on function private.installment_group_amounts(integer,bigint,jsonb,bigint) from public,anon,authenticated;

-- Cadastro: conserva as validações existentes e expande os grupos no banco.
CREATE OR REPLACE FUNCTION private.create_lawyer_contract_groups(p_contract_id uuid, p_client_name text, p_cpf text, p_contract_date date, p_total_cents bigint, p_origin text, p_percentage smallint, p_payment_method text, p_file_path text, p_file_name text, p_schedule jsonb, p_payment_start_type text, p_first_due_date date, p_payment_start_condition text, p_installment_count integer, p_installment_cents bigint, p_has_additional_fee boolean, p_additional_fee_percentage numeric, p_additional_fee_basis text, p_additional_fee_amount_cents bigint, p_last_installment_cents bigint, p_groups jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_client_id uuid;
  v_existing_name text;
  v_item jsonb;
  v_order integer := 0;
  v_regular integer := 0;
  v_entry_count integer := 0;
  v_cents bigint;
  v_amounts bigint[];
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
  v_amounts:=private.installment_group_amounts(p_installment_count,p_installment_cents,p_groups,p_last_installment_cents);
  if p_payment_method<>'installments' and p_groups<>'[]'::jsonb then raise exception 'Grupos exigem pagamento parcelado';end if;
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
       p_total_cents <> (select sum(v) from unnest(v_amounts) v) then
      raise exception 'Contrato condicionado não deve gerar parcelas ou divergir do valor total';
    end if;
  elsif jsonb_array_length(p_schedule) < 1 then
    raise exception 'Cronograma obrigatório para vencimento definido';
  end if;

  insert into public.clients (full_name, cpf, office_id)
  values (trim(p_client_name), p_cpf, private.current_office_id())
    on conflict (office_id, cpf) where cpf is not null do nothing;
  select id, full_name into v_client_id, v_existing_name
    from public.clients where cpf = p_cpf and office_id = private.current_office_id();
  if lower(trim(v_existing_name)) <> lower(trim(p_client_name)) then
    raise exception 'CPF já cadastrado com nome diferente; confirme os dados com o administrador';
  end if;

  insert into public.contracts
    (id, client_id, lawyer_id, origin, total_contract_value, contract_date,
     contract_file_path, contract_file_name, payment_method, payment_start_type,
     first_due_date, payment_start_condition, installment_count, installment_amount,
     last_installment_amount, installment_groups,
     has_additional_fee, additional_fee_percentage, additional_fee_basis, additional_fee_amount)
  values
    (p_contract_id, v_client_id, v_actor, p_origin, p_total_cents::numeric / 100,
     p_contract_date, p_file_path, trim(p_file_name), p_payment_method, p_payment_start_type,
     p_first_due_date, nullif(trim(p_payment_start_condition), ''), p_installment_count,
     p_installment_cents::numeric / 100, p_last_installment_cents::numeric / 100, p_groups,
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
           v_amounts[v_regular]) or
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
$function$
;

-- Vínculos dos contratantes e isolamento entre escritórios permanecem iguais.
CREATE OR REPLACE FUNCTION private.create_contract_with_parties(p_contract_id uuid, p_parties jsonb, p_details jsonb, p_schedule jsonb, p_file_path text, p_file_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_party jsonb; v_index integer:=0; v_client uuid; v_name text; v_primary jsonb;
  v_office uuid:=private.current_office_id(); v_field text; v_amount numeric;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' or v_office is null then
    raise exception 'Acesso não autorizado'; end if;
  if p_parties is null or jsonb_typeof(p_parties)<>'array' or jsonb_array_length(p_parties) not between 1 and 20 or
    p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'Confira os contratantes e os dados do contrato'; end if;
  for v_party in select value from jsonb_array_elements(p_parties) loop
    if jsonb_typeof(v_party)<>'object' or jsonb_typeof(v_party->'fullName') is distinct from 'string' or
      length(trim(v_party->>'fullName')) not between 2 and 160 or
      jsonb_typeof(v_party->'cpf') is distinct from 'string' or not private.valid_cpf(v_party->>'cpf') then
      raise exception 'Informe nome completo e CPF válido para todos os contratantes'; end if;
  end loop;
  if (select count(distinct value->>'cpf') from jsonb_array_elements(p_parties))<>jsonb_array_length(p_parties) then
    raise exception 'O mesmo CPF não pode ser incluído duas vezes no contrato'; end if;
  if (p_details->>'commission_percentage')::numeric not in (5,10,15,20,25,30,35,40,45,50,55,60) or
    p_details->>'commission_percentage' is null then raise exception 'Selecione um percentual permitido'; end if;
  if p_details->>'payment_method' is null or p_details->>'payment_method' not in ('cash','installments','success_only') then
    raise exception 'Selecione a forma de pagamento'; end if;
  foreach v_field in array array['total_contract_value','installment_amount','last_installment_amount','additional_fee_amount'] loop
    if p_details->>v_field is not null then
      v_amount:=(p_details->>v_field)::numeric;
      if jsonb_typeof(p_details->v_field)<>'number' or v_amount<0 or v_amount>999999999999.99 or v_amount<>round(v_amount,2) then
        raise exception 'Valor financeiro inválido'; end if;
    end if;
  end loop;
  if coalesce(p_details->'installment_groups','[]'::jsonb)<>'[]'::jsonb and p_details->>'payment_method'<>'installments' then raise exception 'Grupos exigem pagamento parcelado';end if;
  v_primary:=p_parties->0;
  if p_details->>'payment_method'='success_only' then
    if p_schedule is null or p_schedule<>'[]'::jsonb then raise exception 'Contrato apenas no êxito não possui parcelas'; end if;
    perform private.create_success_contract(p_contract_id,v_primary->>'fullName',v_primary->>'cpf',
      (p_details->>'contract_date')::date,p_details->>'origin',(p_details->>'commission_percentage')::smallint,
      (p_details->>'success_fee_percentage')::numeric,p_file_path,p_file_name);
  else
    perform private.create_lawyer_contract_groups(p_contract_id,v_primary->>'fullName',v_primary->>'cpf',
      (p_details->>'contract_date')::date,((p_details->>'total_contract_value')::numeric*100)::bigint,
      p_details->>'origin',(p_details->>'commission_percentage')::smallint,p_details->>'payment_method',
      p_file_path,p_file_name,p_schedule,p_details->>'payment_start_type',(p_details->>'first_due_date')::date,
      p_details->>'payment_start_condition',(p_details->>'installment_count')::integer,
      ((p_details->>'installment_amount')::numeric*100)::bigint,(p_details->>'has_additional_fee')::boolean,
      (p_details->>'additional_fee_percentage')::numeric,p_details->>'additional_fee_basis',
      ((p_details->>'additional_fee_amount')::numeric*100)::bigint,((p_details->>'last_installment_amount')::numeric*100)::bigint,coalesce(p_details->'installment_groups','[]'::jsonb));
  end if;
  for v_party in select value from jsonb_array_elements(p_parties) loop
    v_index:=v_index+1;
    insert into public.clients(full_name,cpf,office_id) values(trim(v_party->>'fullName'),v_party->>'cpf',v_office)
      on conflict(office_id,cpf) where cpf is not null do nothing;
    select id,full_name into v_client,v_name from public.clients where office_id=v_office and cpf=v_party->>'cpf';
    if lower(trim(v_name))<>lower(trim(v_party->>'fullName')) then
      raise exception 'CPF já cadastrado com nome diferente. Confira os dados do contratante'; end if;
    insert into public.contract_parties(contract_id,client_id,office_id,position) values(p_contract_id,v_client,v_office,v_index)
      on conflict(contract_id,client_id) do nothing;
  end loop;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    select auth.uid(),auth.uid(),'contracts',p_contract_id,'contractors',null,
      jsonb_agg(jsonb_build_object('client_id',client_id,'position',position) order by position),'Contratantes vinculados no cadastro'
      from public.contract_parties where contract_id=p_contract_id;
  return p_contract_id;
end;
$function$
;

-- Edição: grupos entram na auditoria junto do cronograma.
CREATE OR REPLACE FUNCTION private.edit_lawyer_contract(p_contract_id uuid, p_expected_updated_at timestamp with time zone, p_changes jsonb, p_schedule jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old public.contracts%rowtype; v_next public.contracts%rowtype;
  v_old_percentage numeric; v_percentage numeric;
  v_old_schedule jsonb; v_new_schedule jsonb; v_before jsonb; v_after jsonb;
  v_field text; v_item jsonb; v_amount numeric; v_cents bigint; v_sum bigint := 0;
  v_order integer := 0; v_regular integer := 0; v_entry integer := 0;
  v_kind text; v_regular_number integer; v_due date; v_entry_due date;
  v_full boolean := p_schedule is not null;
  v_amounts bigint[];
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then
    raise exception 'Acesso não autorizado'; end if;
  perform private.lock_lawyer_finance(auth.uid());
  select * into v_old from public.contracts where id = p_contract_id
    and lawyer_id = auth.uid() and office_id = private.current_office_id()
    and deleted_at is null for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_old.updated_at then
    raise exception 'O contrato foi alterado. Recarregue a página antes de salvar'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Informe um motivo entre 5 e 1000 caracteres'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Dados do contrato inválidos'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in (
    'origin','contract_date','service_name','contract_file_path','contract_file_name','commission_percentage',
    'total_contract_value','payment_method','success_fee_percentage','payment_start_type',
    'first_due_date','payment_start_condition','installment_count','installment_amount',
    'last_installment_amount','installment_groups','has_additional_fee','additional_fee_percentage',
    'additional_fee_basis','additional_fee_amount')) then
    raise exception 'Campo não permitido'; end if;
  if not v_full and (p_changes - array['origin','contract_date','service_name','contract_file_path','contract_file_name']) <> '{}'::jsonb then
    raise exception 'Alteração financeira exige revisão do cronograma'; end if;
  if v_full and (exists (select 1 from public.payments p join public.installments i
      on i.id = p.installment_id where i.contract_id = p_contract_id) or
    exists (select 1 from public.collection_notes where contract_id = p_contract_id and installment_id is not null)) then
    raise exception 'Contrato com histórico de pagamentos ou cobranças por parcela. Solicite a correção financeira ao gestor'; end if;

  select commission_percentage into v_old_percentage from public.contract_financial_terms where contract_id = p_contract_id;
  v_percentage := v_old_percentage;
  v_next := jsonb_populate_record(v_old, p_changes - 'commission_percentage');
  if p_changes ? 'service_name' then
    if jsonb_typeof(p_changes->'service_name') is distinct from 'string' or
      length(trim(p_changes->>'service_name')) not between 2 and 240 then
      raise exception 'Informe o serviço contratado ou nome da ação, entre 2 e 240 caracteres'; end if;
    v_next.service_name := trim(p_changes->>'service_name');
  end if;
  if v_next.origin is null or v_next.origin not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP') or
    v_next.contract_date is null then raise exception 'Confira a origem e a data do contrato'; end if;
  if v_next.contract_file_path is null then
    if v_next.contract_file_name is not null then raise exception 'Arquivo sem caminho'; end if;
  elsif v_next.contract_file_name is null or length(trim(v_next.contract_file_name)) not between 1 and 255 then
    raise exception 'Nome de PDF inválido';
  elsif v_next.contract_file_path is distinct from v_old.contract_file_path then
    if
      storage.foldername(v_next.contract_file_path) <> array['contracts',auth.uid()::text,p_contract_id::text] or
      storage.filename(v_next.contract_file_path) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' or
      not exists (select 1 from storage.objects where bucket_id = 'contract-pdfs'
        and name = v_next.contract_file_path and owner_id = auth.uid()::text) then
      raise exception 'PDF não encontrado ou sem permissão'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('installment_number',i.installment_number,
    'kind',i.kind,'regular_number',i.regular_number,'due_date',i.due_date,
    'amount_cents',(i.contractual_amount * 100)::bigint) order by i.installment_number),'[]'::jsonb)
    into v_old_schedule from public.installments i where i.contract_id = p_contract_id;
  v_new_schedule := v_old_schedule;
  if v_full then
    if not (p_changes ?& array['commission_percentage','total_contract_value','payment_method',
      'success_fee_percentage','payment_start_type','first_due_date','payment_start_condition',
      'installment_count','installment_amount','last_installment_amount','has_additional_fee',
      'additional_fee_percentage','additional_fee_basis','additional_fee_amount']) then
      raise exception 'Informe todos os dados financeiros'; end if;
    v_percentage := (p_changes->>'commission_percentage')::numeric;
    if v_percentage is null or v_percentage not in (5,10,15,20,25,30,35,40,45,50,55,60) then
      raise exception 'Selecione um percentual permitido'; end if;
    foreach v_field in array array['total_contract_value','installment_amount','last_installment_amount','additional_fee_amount'] loop
      if p_changes->>v_field is not null then
        v_amount := (p_changes->>v_field)::numeric;
        if jsonb_typeof(p_changes->v_field) <> 'number' or v_amount < 0 or v_amount > 999999999999.99 or
          v_amount <> round(v_amount,2) then raise exception 'Valor financeiro inválido'; end if;
      end if;
    end loop;
    foreach v_field in array array['success_fee_percentage','additional_fee_percentage'] loop
      if p_changes->>v_field is not null then
        v_amount := (p_changes->>v_field)::numeric;
        if jsonb_typeof(p_changes->v_field) <> 'number' or v_amount <= 0 or v_amount > 100 or
          v_amount <> round(v_amount,2) then raise exception 'Percentual inválido'; end if;
      end if;
    end loop;
    if jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) > 121 or
      v_next.payment_method is null or v_next.payment_method not in ('cash','installments','success_only') then
      raise exception 'Forma de pagamento ou cronograma inválido'; end if;
    if v_next.installment_groups is null or jsonb_typeof(v_next.installment_groups) is distinct from 'array' or
      (v_next.payment_method<>'installments' and v_next.installment_groups<>'[]'::jsonb) then raise exception 'Confira os grupos de parcelas';end if;
    if v_next.payment_method = 'success_only' then
      if jsonb_array_length(p_schedule) <> 0 then raise exception 'Contrato apenas no êxito não possui parcelas'; end if;
    else
      if v_next.total_contract_value is null or v_next.total_contract_value <= 0 or
        v_next.installment_count is null or v_next.installment_count not between 1 and 120 or
        v_next.installment_amount is null or v_next.installment_amount <= 0 or
        (v_next.payment_method = 'cash' and v_next.installment_count <> 1) or
        v_next.payment_start_type is null or v_next.payment_start_type not in ('fixed_date','condition') then
        raise exception 'Dados financeiros inválidos'; end if;
      v_amounts:=private.installment_group_amounts(v_next.installment_count,(v_next.installment_amount*100)::bigint,v_next.installment_groups,(v_next.last_installment_amount*100)::bigint);
      if v_next.payment_start_type = 'condition' then
        if jsonb_array_length(p_schedule) <> 0 or v_next.total_contract_value <>
          (select sum(v)::numeric/100 from unnest(v_amounts) v) then
          raise exception 'Contrato condicionado não deve gerar parcelas ou divergir do total'; end if;
      else
        for v_item in select value from jsonb_array_elements(p_schedule) loop
          v_order := v_order + 1;
          v_cents := (v_item->>'amount_cents')::bigint;
          v_due := (v_item->>'due_date')::date;
          v_kind := v_item->>'kind';
          v_regular_number := (v_item->>'regular_number')::integer;
          if v_cents is null or v_cents <= 0 or v_cents > 99999999999999 or v_due is null or
            (v_item->>'installment_number')::integer is distinct from v_order or
            v_kind is null or v_kind not in ('down_payment','regular') then raise exception 'Parcela inválida'; end if;
          if v_kind = 'down_payment' then
            v_entry := v_entry + 1; v_entry_due := v_due;
            if v_order <> 1 or v_entry > 1 or v_regular_number is not null or v_next.payment_method <> 'installments' then
              raise exception 'Entrada inválida'; end if;
          else
            v_regular := v_regular + 1;
            if v_regular_number is distinct from v_regular or
              v_cents is distinct from v_amounts[v_regular] or
              v_due is distinct from private.add_months_clamped(v_next.first_due_date,v_regular - 1) or
              (v_entry_due is not null and v_entry_due > v_next.first_due_date) then
              raise exception 'Valor, ordem ou vencimento das parcelas inválidos'; end if;
          end if;
          v_sum := v_sum + v_cents;
        end loop;
        if v_regular <> v_next.installment_count or v_sum::numeric / 100 <> v_next.total_contract_value then
          raise exception 'Total do cronograma diverge do contrato'; end if;
      end if;
    end if;
    v_new_schedule := p_schedule;
    if v_old_schedule is distinct from v_new_schedule then
      delete from public.installments where contract_id = p_contract_id;
    end if;
  end if;

  update public.contracts set origin=v_next.origin,contract_date=v_next.contract_date,
    service_name=v_next.service_name,
    contract_file_path=v_next.contract_file_path,contract_file_name=v_next.contract_file_name,
    total_contract_value=v_next.total_contract_value,payment_method=v_next.payment_method,
    success_fee_percentage=v_next.success_fee_percentage,payment_start_type=v_next.payment_start_type,
    first_due_date=v_next.first_due_date,payment_start_condition=v_next.payment_start_condition,
    installment_count=v_next.installment_count,installment_amount=v_next.installment_amount,installment_groups=v_next.installment_groups,
    last_installment_amount=v_next.last_installment_amount,has_additional_fee=v_next.has_additional_fee,
    additional_fee_percentage=v_next.additional_fee_percentage,additional_fee_basis=v_next.additional_fee_basis,
    additional_fee_amount=v_next.additional_fee_amount where id=p_contract_id;
  if v_full then
    update public.contract_financial_terms set commission_percentage=v_percentage where contract_id=p_contract_id;
    if v_old_schedule is distinct from v_new_schedule then
      insert into public.installments(contract_id,installment_number,kind,regular_number,due_date,contractual_amount)
        select p_contract_id,(i->>'installment_number')::integer,i->>'kind',(i->>'regular_number')::integer,
          (i->>'due_date')::date,(i->>'amount_cents')::numeric/100 from jsonb_array_elements(p_schedule) i;
    end if;
  end if;
  v_before := to_jsonb(v_old) - array['created_at','updated_at'];
  v_after := to_jsonb(v_next) - array['created_at','updated_at'];
  for v_field in select jsonb_object_keys(v_before) loop
    if v_before->v_field is distinct from v_after->v_field then
      insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
        values(auth.uid(),v_old.lawyer_id,'contracts',p_contract_id,v_field,v_before->v_field,v_after->v_field,trim(p_reason));
    end if;
  end loop;
  if v_percentage is distinct from v_old_percentage then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),v_old.lawyer_id,'contract_financial_terms',p_contract_id,'commission_percentage',
        to_jsonb(v_old_percentage),to_jsonb(v_percentage),trim(p_reason));
  end if;
  if v_old_schedule is distinct from v_new_schedule then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),v_old.lawyer_id,'contracts',p_contract_id,'installments',v_old_schedule,v_new_schedule,trim(p_reason));
  end if;
  return p_contract_id;
end;
$function$
;

revoke all on function private.create_lawyer_contract_groups(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint,jsonb) from public,anon,authenticated;
create or replace function public.create_lawyer_contract_v8(p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text)
returns uuid language sql security invoker set search_path='' as $$select public.create_lawyer_contract_v7(p_contract_id,p_parties,p_details,p_schedule,p_file_path,p_file_name)$$;
create or replace function public.edit_lawyer_contract_v6(p_contract_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_schedule jsonb,p_reason text)
returns uuid language sql security invoker set search_path='' as $$select public.edit_lawyer_contract_v5(p_contract_id,p_expected_updated_at,p_changes,p_schedule,p_reason)$$;
revoke all on function public.create_lawyer_contract_v8(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v6(uuid,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_lawyer_contract_v8(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v6(uuid,timestamptz,jsonb,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
