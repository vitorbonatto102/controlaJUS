-- Um contrato, vários contratantes, um único cronograma financeiro.
-- Aplicar após 20261022000300. Reaplicável no SQL Editor.
begin;
create table if not exists public.contract_parties (
  contract_id uuid not null references public.contracts(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  office_id uuid not null references public.offices(id),
  position integer not null check(position between 1 and 20),
  created_at timestamptz not null default now(),
  primary key(contract_id,client_id), unique(contract_id,position)
);
comment on table public.contract_parties is 'Pessoas contratantes. A posição 1 preserva contracts.client_id; parcelas, pagamentos e comissões pertencem ao contrato e não se multiplicam por pessoa.';
create index if not exists contract_parties_client on public.contract_parties(client_id,contract_id);
alter table public.contract_parties enable row level security;
revoke all on public.contract_parties from anon,authenticated;
grant select on public.contract_parties to authenticated;
drop policy if exists contract_parties_read on public.contract_parties;
create policy contract_parties_read on public.contract_parties for select to authenticated using (
  office_id=(select private.current_office_id()) and exists(select 1 from public.contracts c where c.id=contract_id));
drop policy if exists clients_party_read on public.clients;
create policy clients_party_read on public.clients for select to authenticated using (
  office_id=(select private.current_office_id()) and (select private.current_role())='lawyer' and
  exists(select 1 from public.contract_parties p join public.contracts c on c.id=p.contract_id
    where p.client_id=clients.id and c.lawyer_id=(select auth.uid())));

create or replace function private.guard_contract_party_office() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_office uuid; v_client_office uuid; v_primary uuid;
begin
  select office_id,client_id into v_office,v_primary from public.contracts where id=new.contract_id;
  select office_id into v_client_office from public.clients where id=new.client_id;
  if v_office is null or v_client_office is distinct from v_office or new.office_id is distinct from v_office or
    (new.position=1 and new.client_id<>v_primary) or (new.position<>1 and new.client_id=v_primary) then
    raise exception 'Contratante e contrato devem pertencer ao mesmo escritório'; end if;
  return new;
end;
$$;
revoke all on function private.guard_contract_party_office() from public,anon,authenticated;
drop trigger if exists contract_parties_office_guard on public.contract_parties;
create trigger contract_parties_office_guard before insert or update on public.contract_parties
  for each row execute function private.guard_contract_party_office();
insert into public.contract_parties(contract_id,client_id,office_id,position)
  select id,client_id,office_id,1 from public.contracts on conflict(contract_id,client_id) do nothing;

create or replace function private.link_primary_contract_party() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.contract_parties(contract_id,client_id,office_id,position)
    values(new.id,new.client_id,new.office_id,1) on conflict(contract_id,client_id) do nothing;
  return new;
end;
$$;
revoke all on function private.link_primary_contract_party() from public,anon,authenticated;
drop trigger if exists contracts_link_primary_party on public.contracts;
create trigger contracts_link_primary_party after insert on public.contracts
  for each row execute function private.link_primary_contract_party();

create or replace function private.contract_has_client(p_contract uuid,p_client uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.contracts c where c.id=p_contract and c.deleted_at is null
    and c.office_id=private.current_office_id() and (c.client_id=p_client or exists(
      select 1 from public.contract_parties p where p.contract_id=c.id and p.client_id=p_client)));
$$;
revoke all on function private.contract_has_client(uuid,uuid) from public,anon,authenticated;

-- A secretaria pode cobrar e registrar histórico para qualquer contratante vinculado.
create or replace function public.ensure_note_contract_client() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.contract_id is not null and not private.contract_has_client(new.contract_id,new.client_id) then
    raise exception 'Contrato não pertence ao cliente informado'; end if;
  if new.installment_id is not null and (new.contract_id is null or not exists(
    select 1 from public.installments i where i.id=new.installment_id and i.contract_id=new.contract_id)) then
    raise exception 'Parcela não pertence ao contrato informado'; end if;
  return new;
end;
$$;
revoke all on function public.ensure_note_contract_client() from public,anon,authenticated;
do $scope$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('private.enforce_office_scope()'::regprocedure);
  if position('private.contract_has_client(new.contract_id,new.client_id)' in v_definition)=0 then
    if position('v_office is distinct from v_client_office or new.client_id <> v_client' in v_definition)=0 then
      raise exception 'Guarda de escritório incompatível. Confira as migrations anteriores'; end if;
    v_definition:=replace(v_definition,
      'v_office is distinct from v_client_office or new.client_id <> v_client',
      'v_office is distinct from v_client_office or not private.contract_has_client(new.contract_id,new.client_id)');
    execute v_definition;
  end if;
end;
$scope$;

create or replace function private.create_contract_with_parties(
  p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text
) returns uuid language plpgsql security definer set search_path='' as $$
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
  v_primary:=p_parties->0;
  if p_details->>'payment_method'='success_only' then
    if p_schedule is null or p_schedule<>'[]'::jsonb then raise exception 'Contrato apenas no êxito não possui parcelas'; end if;
    perform private.create_success_contract(p_contract_id,v_primary->>'fullName',v_primary->>'cpf',
      (p_details->>'contract_date')::date,p_details->>'origin',(p_details->>'commission_percentage')::smallint,
      (p_details->>'success_fee_percentage')::numeric,p_file_path,p_file_name);
  else
    perform private.create_lawyer_contract_v2(p_contract_id,v_primary->>'fullName',v_primary->>'cpf',
      (p_details->>'contract_date')::date,((p_details->>'total_contract_value')::numeric*100)::bigint,
      p_details->>'origin',(p_details->>'commission_percentage')::smallint,p_details->>'payment_method',
      p_file_path,p_file_name,p_schedule,p_details->>'payment_start_type',(p_details->>'first_due_date')::date,
      p_details->>'payment_start_condition',(p_details->>'installment_count')::integer,
      ((p_details->>'installment_amount')::numeric*100)::bigint,(p_details->>'has_additional_fee')::boolean,
      (p_details->>'additional_fee_percentage')::numeric,p_details->>'additional_fee_basis',
      ((p_details->>'additional_fee_amount')::numeric*100)::bigint,((p_details->>'last_installment_amount')::numeric*100)::bigint);
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
$$;
create or replace function public.create_contract_with_parties(p_contract_id uuid,p_parties jsonb,p_details jsonb,
  p_schedule jsonb,p_file_path text,p_file_name text) returns uuid language sql security invoker set search_path='' as $$
  select private.create_contract_with_parties(p_contract_id,p_parties,p_details,p_schedule,p_file_path,p_file_name);
$$;
revoke all on function private.create_contract_with_parties(uuid,jsonb,jsonb,jsonb,text,text),
  public.create_contract_with_parties(uuid,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.create_contract_with_parties(uuid,jsonb,jsonb,jsonb,text,text),
  public.create_contract_with_parties(uuid,jsonb,jsonb,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
