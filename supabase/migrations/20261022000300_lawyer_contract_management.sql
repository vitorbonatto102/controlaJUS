-- Gestão dos próprios contratos: edição transacional e exclusão lógica auditada.
-- Reaplicável no SQL Editor. Não concede UPDATE/DELETE direto pela API.
begin;

alter table public.contracts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists deletion_reason text;
comment on column public.contracts.deleted_at is
  'Exclusão lógica. Mantém documento e trilha de auditoria; contratos com pagamentos não podem ser excluídos pela advogada.';

drop policy if exists contracts_not_deleted on public.contracts;
create policy contracts_not_deleted on public.contracts as restrictive for all to authenticated
  using (deleted_at is null) with check (deleted_at is null);

-- Serializa novos lançamentos com edição/exclusão do contrato. As políticas das
-- parcelas já consultam contracts e herdam o filtro dos contratos excluídos.
create or replace function private.guard_deleted_contract_child() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_contract uuid; v_deleted timestamptz;
begin
  if tg_table_name = 'payments' then
    select contract_id into v_contract from public.installments where id = new.installment_id;
  else v_contract := new.contract_id;
  end if;
  select deleted_at into v_deleted from public.contracts where id = v_contract for share;
  if not found or v_deleted is not null then raise exception 'Contrato indisponível'; end if;
  return new;
end;
$$;
revoke all on function private.guard_deleted_contract_child() from public, anon, authenticated;
drop trigger if exists payments_active_contract_guard on public.payments;
create trigger payments_active_contract_guard before insert or update on public.payments
  for each row execute function private.guard_deleted_contract_child();
drop trigger if exists installments_active_contract_guard on public.installments;
create trigger installments_active_contract_guard before insert or update on public.installments
  for each row execute function private.guard_deleted_contract_child();

-- Uma correção do gestor em parcelas/percentuais também invalida formulários
-- antigos. O carimbo do contrato representa a versão de todo o agregado.
create or replace function private.touch_contract_management_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.contracts set updated_at=now() where id=old.contract_id;
    return old;
  end if;
  update public.contracts set updated_at=now() where id=new.contract_id;
  return new;
end;
$$;
revoke all on function private.touch_contract_management_version() from public,anon,authenticated;
drop trigger if exists terms_contract_version on public.contract_financial_terms;
create trigger terms_contract_version after update on public.contract_financial_terms
  for each row execute function private.touch_contract_management_version();
drop trigger if exists installments_contract_version on public.installments;
create trigger installments_contract_version after insert or update or delete on public.installments
  for each row execute function private.touch_contract_management_version();

create or replace function private.edit_lawyer_contract(
  p_contract_id uuid, p_expected_updated_at timestamptz, p_changes jsonb,
  p_schedule jsonb, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old public.contracts%rowtype; v_next public.contracts%rowtype;
  v_old_percentage numeric; v_percentage numeric;
  v_old_schedule jsonb; v_new_schedule jsonb; v_before jsonb; v_after jsonb;
  v_field text; v_item jsonb; v_amount numeric; v_cents bigint; v_sum bigint := 0;
  v_order integer := 0; v_regular integer := 0; v_entry integer := 0;
  v_kind text; v_regular_number integer; v_due date; v_entry_due date;
  v_full boolean := p_schedule is not null;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then
    raise exception 'Acesso não autorizado'; end if;
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
    'origin','contract_date','contract_file_path','contract_file_name','commission_percentage',
    'total_contract_value','payment_method','success_fee_percentage','payment_start_type',
    'first_due_date','payment_start_condition','installment_count','installment_amount',
    'last_installment_amount','has_additional_fee','additional_fee_percentage',
    'additional_fee_basis','additional_fee_amount')) then
    raise exception 'Campo não permitido'; end if;
  if not v_full and (p_changes - array['origin','contract_date','contract_file_path','contract_file_name']) <> '{}'::jsonb then
    raise exception 'Alteração financeira exige revisão do cronograma'; end if;
  if v_full and (exists (select 1 from public.payments p join public.installments i
      on i.id = p.installment_id where i.contract_id = p_contract_id) or
    exists (select 1 from public.collection_notes where contract_id = p_contract_id and installment_id is not null)) then
    raise exception 'Contrato com histórico de pagamentos ou cobranças por parcela. Solicite a correção financeira ao gestor'; end if;

  select commission_percentage into v_old_percentage from public.contract_financial_terms where contract_id = p_contract_id;
  v_percentage := v_old_percentage;
  v_next := jsonb_populate_record(v_old, p_changes - 'commission_percentage');
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
    if v_next.payment_method = 'success_only' then
      if jsonb_array_length(p_schedule) <> 0 then raise exception 'Contrato apenas no êxito não possui parcelas'; end if;
    else
      if v_next.total_contract_value is null or v_next.total_contract_value <= 0 or
        v_next.installment_count is null or v_next.installment_count not between 1 and 120 or
        v_next.installment_amount is null or v_next.installment_amount <= 0 or
        (v_next.payment_method = 'cash' and v_next.installment_count <> 1) or
        v_next.payment_start_type is null or v_next.payment_start_type not in ('fixed_date','condition') then
        raise exception 'Dados financeiros inválidos'; end if;
      if v_next.payment_start_type = 'condition' then
        if jsonb_array_length(p_schedule) <> 0 or v_next.total_contract_value <>
          (v_next.installment_count - 1) * v_next.installment_amount +
          coalesce(v_next.last_installment_amount,v_next.installment_amount) then
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
              v_cents::numeric / 100 <> (case when v_regular = v_next.installment_count then
                coalesce(v_next.last_installment_amount,v_next.installment_amount) else v_next.installment_amount end) or
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
    contract_file_path=v_next.contract_file_path,contract_file_name=v_next.contract_file_name,
    total_contract_value=v_next.total_contract_value,payment_method=v_next.payment_method,
    success_fee_percentage=v_next.success_fee_percentage,payment_start_type=v_next.payment_start_type,
    first_due_date=v_next.first_due_date,payment_start_condition=v_next.payment_start_condition,
    installment_count=v_next.installment_count,installment_amount=v_next.installment_amount,
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
$$;

create or replace function private.delete_lawyer_contract(p_contract_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_contract public.contracts%rowtype;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  select * into v_contract from public.contracts where id=p_contract_id and lawyer_id=auth.uid()
    and office_id=private.current_office_id() and deleted_at is null for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_contract.updated_at then
    raise exception 'O contrato foi alterado. Recarregue a página antes de excluir'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Informe o motivo da exclusão'; end if;
  if exists (select 1 from public.payments p join public.installments i on i.id=p.installment_id where i.contract_id=p_contract_id) then
    raise exception 'Contrato com pagamentos registrados não pode ser excluído. Solicite a correção ao gestor'; end if;
  update public.contracts set deleted_at=now(),deleted_by=auth.uid(),deletion_reason=trim(p_reason) where id=p_contract_id;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(auth.uid(),auth.uid(),'contracts',p_contract_id,'deleted_at','null'::jsonb,to_jsonb(now()),trim(p_reason));
  return p_contract_id;
end;
$$;

create or replace function public.edit_lawyer_contract(p_contract_id uuid,p_expected_updated_at timestamptz,
  p_changes jsonb,p_schedule jsonb,p_reason text) returns uuid language sql security invoker set search_path = '' as $$
  select private.edit_lawyer_contract(p_contract_id,p_expected_updated_at,p_changes,p_schedule,p_reason);
$$;
create or replace function public.delete_lawyer_contract(p_contract_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.delete_lawyer_contract(p_contract_id,p_expected_updated_at,p_reason);
$$;
revoke all on function private.edit_lawyer_contract(uuid,timestamptz,jsonb,jsonb,text),
  public.edit_lawyer_contract(uuid,timestamptz,jsonb,jsonb,text),
  private.delete_lawyer_contract(uuid,timestamptz,text),public.delete_lawyer_contract(uuid,timestamptz,text)
  from public,anon,authenticated;
grant execute on function private.edit_lawyer_contract(uuid,timestamptz,jsonb,jsonb,text),
  public.edit_lawyer_contract(uuid,timestamptz,jsonb,jsonb,text),
  private.delete_lawyer_contract(uuid,timestamptz,text),public.delete_lawyer_contract(uuid,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
commit;
