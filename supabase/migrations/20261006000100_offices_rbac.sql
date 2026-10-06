-- Multi-escritório: vínculo de cada usuário aos dados do próprio escritório e
-- permissão administrativa separada do cargo operacional.
begin;

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.offices is 'Tenant organizacional. Usuários e registros operacionais pertencem a um único escritório.';

alter table public.profiles
  add column if not exists office_id uuid references public.offices(id),
  add column if not exists is_office_admin boolean not null default false;
alter table public.clients add column if not exists office_id uuid references public.offices(id);
alter table public.contracts add column if not exists office_id uuid references public.offices(id);
alter table public.audit_logs add column if not exists office_id uuid references public.offices(id);
alter table public.notifications add column if not exists office_id uuid references public.offices(id);

-- O backfill abaixo só acrescenta o tenant aos registros históricos. A trigger
-- de imutabilidade é suspensa dentro desta transação e recriada imediatamente
-- após o backfill; se a migration falhar, o rollback restaura a trigger.
drop trigger if exists audit_immutable on public.audit_logs;

do $migration$
declare v_office uuid;
begin
  insert into public.offices(name, slug) values ('Escritório principal', 'principal')
    on conflict (slug) do update set slug = excluded.slug returning id into v_office;

  -- A role antiga `admin` era exclusiva. Ela passa a ser `manager` com a
  -- permissão adicional de administração do escritório, que o usuário pode
  -- ajustar depois na própria tela de administração.
  update public.profiles set role = 'manager', is_office_admin = true where role = 'admin';
  -- O primeiro backfill migra contas legadas. Reexecutar o arquivo não deve
  -- atribuir a um escritório convites novos que ainda estejam sem vínculo.
  if not exists (select 1 from public.profiles where office_id is not null) then
    update public.profiles set office_id = v_office where office_id is null;
  end if;
  update public.clients set office_id = v_office where office_id is null;
  update public.contracts c set office_id = p.office_id
    from public.profiles p where p.id = c.lawyer_id and c.office_id is null;
  update public.contracts set office_id = v_office where office_id is null;
  update public.audit_logs a set office_id = coalesce(
    (select p.office_id from public.profiles p where p.id = a.affected_lawyer_id),
    (select p.office_id from public.profiles p where p.id = a.user_id), v_office)
    where a.office_id is null;
  update public.audit_logs set office_id = v_office where office_id is null;
  update public.notifications n set office_id = p.office_id
    from public.profiles p where p.id = n.user_id and n.office_id is null;
  update public.notifications set office_id = v_office where office_id is null;
end;
$migration$;

create trigger audit_immutable before update or delete on public.audit_logs
  for each row execute function public.reject_audit_mutation();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('lawyer', 'secretary', 'manager'));
alter table public.clients alter column office_id set not null;
alter table public.contracts alter column office_id set not null;
alter table public.audit_logs alter column office_id set not null;
alter table public.notifications alter column office_id set not null;

-- CPF é único dentro do escritório. Escritórios distintos podem atender o
-- mesmo cliente sem compartilhar linha ou revelar a existência do cadastro.
do $constraints$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.clients'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (cpf)'
  loop
    execute format('alter table public.clients drop constraint %I', v_name);
  end loop;
end;
$constraints$;
create unique index if not exists clients_office_cpf_unique
  on public.clients (office_id, cpf) where cpf is not null;
create index if not exists profiles_office_role_active
  on public.profiles (office_id, role, active, full_name);
create index if not exists clients_office_name on public.clients (office_id, full_name);
create index if not exists contracts_office_date on public.contracts (office_id, contract_date desc);
create index if not exists audit_logs_office_time on public.audit_logs (office_id, created_at desc);
create index if not exists notifications_office_time on public.notifications (office_id, created_at desc);

create or replace function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active = true and p.office_id is not null
$$;
revoke all on function private.current_role() from public;
grant execute on function private.current_role() to authenticated;

create or replace function private.current_office_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.office_id from public.profiles p
  where p.id = auth.uid() and p.active = true and p.office_id is not null
$$;
revoke all on function private.current_office_id() from public, anon;
grant execute on function private.current_office_id() to authenticated;

create or replace function private.is_office_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_office_admin from public.profiles p
    where p.id = auth.uid() and p.active = true and p.office_id is not null), false)
$$;
revoke all on function private.is_office_admin() from public, anon;
grant execute on function private.is_office_admin() to authenticated;

create or replace function private.enforce_profile_office() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor_office uuid := private.current_office_id();
begin
  -- Migrations e operações de provisionamento pelo servidor não têm JWT.
  if auth.uid() is null then return new; end if;
  -- O trigger do Supabase Auth mantém o e-mail sincronizado. Essa atualização
  -- isolada não altera cargo, ativação, escritório ou permissão administrativa.
  if new.email is distinct from old.email and
    new.id is not distinct from old.id and
    new.full_name is not distinct from old.full_name and
    new.role is not distinct from old.role and
    new.active is not distinct from old.active and
    new.office_id is not distinct from old.office_id and
    new.is_office_admin is not distinct from old.is_office_admin then
    return new;
  end if;
  if v_actor_office is null or not private.is_office_admin() then
    raise exception 'Acesso não autorizado';
  end if;
  if old.office_id is not null and new.office_id is distinct from old.office_id then
    raise exception 'Usuário já pertence a outro escritório';
  end if;
  if new.office_id is null then new.office_id := v_actor_office; end if;
  if new.office_id <> v_actor_office then raise exception 'Escritório não autorizado'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_profile_office() from public, anon, authenticated;

create or replace function private.enforce_office_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_office uuid := private.current_office_id();
  v_office uuid;
  v_client_office uuid;
  v_lawyer uuid;
  v_client uuid;
begin
  if auth.uid() is null then return new; end if;
  if v_actor_office is null then raise exception 'Usuário sem escritório ativo'; end if;

  case tg_table_name
    when 'clients' then
      if tg_op = 'INSERT' and new.office_id is null then new.office_id := v_actor_office; end if;
      if tg_op = 'UPDATE' and new.office_id is distinct from old.office_id then
        raise exception 'O escritório do cliente não pode ser alterado';
      end if;
      v_office := new.office_id;
    when 'contracts' then
      select office_id into v_office from public.profiles where id = new.lawyer_id;
      select office_id into v_client_office from public.clients where id = new.client_id;
      if v_office is null or v_client_office is null or v_office <> v_client_office then
        raise exception 'Advogada e cliente devem pertencer ao mesmo escritório';
      end if;
      if tg_op = 'INSERT' and new.office_id is null then new.office_id := v_office; end if;
      if new.office_id <> v_office or (tg_op = 'UPDATE' and new.office_id is distinct from old.office_id) then
        raise exception 'Escritório do contrato inválido';
      end if;
    when 'contract_financial_terms' then
      select office_id into v_office from public.contracts where id = new.contract_id;
    when 'installments' then
      select office_id into v_office from public.contracts where id = new.contract_id;
    when 'payments' then
      select c.office_id into v_office from public.installments i
        join public.contracts c on c.id = i.contract_id where i.id = new.installment_id;
    when 'commissions' then
      select c.office_id, c.lawyer_id into v_office, v_lawyer
        from public.payments p join public.installments i on i.id = p.installment_id
        join public.contracts c on c.id = i.contract_id where p.id = new.payment_id;
      if new.lawyer_id <> v_lawyer then raise exception 'Comissão vinculada à advogada incorreta'; end if;
    when 'collection_notes' then
      select office_id into v_office from public.clients where id = new.client_id;
      if new.contract_id is not null then
        select office_id, client_id into v_client_office, v_client
          from public.contracts where id = new.contract_id;
        if v_office is distinct from v_client_office or new.client_id <> v_client then
          raise exception 'Contrato não pertence ao cliente neste escritório';
        end if;
      end if;
      if new.installment_id is not null and not exists (
        select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
      ) then raise exception 'Parcela não pertence ao contrato informado'; end if;
    when 'monthly_closings' then
      select office_id into v_office from public.profiles where id = new.lawyer_id;
    when 'monthly_closing_items' then
      select p.office_id into v_office from public.monthly_closings mc
        join public.profiles p on p.id = mc.lawyer_id where mc.id = new.closing_id;
    when 'closing_adjustments' then
      select p.office_id into v_office from public.monthly_closings mc
        join public.profiles p on p.id = mc.lawyer_id where mc.id = new.closing_id;
    when 'commission_transfers' then
      select p.office_id, mc.lawyer_id into v_office, v_lawyer
        from public.monthly_closings mc join public.profiles p on p.id = mc.lawyer_id
        where mc.id = new.closing_id;
      if new.lawyer_id <> v_lawyer then raise exception 'Repasse vinculado à advogada incorreta'; end if;
    when 'audit_logs' then
      if new.affected_lawyer_id is not null then
        select office_id into v_office from public.profiles where id = new.affected_lawyer_id;
      else
        v_office := v_actor_office;
      end if;
      if tg_op = 'INSERT' and new.office_id is null then new.office_id := v_office; end if;
      if new.office_id <> v_office or (tg_op = 'UPDATE' and new.office_id is distinct from old.office_id) then
        raise exception 'Escritório do log inválido';
      end if;
    when 'notifications' then
      select office_id into v_office from public.profiles where id = new.user_id;
      if tg_op = 'INSERT' and new.office_id is null then new.office_id := v_office; end if;
      if new.office_id <> v_office or (tg_op = 'UPDATE' and new.office_id is distinct from old.office_id) then
        raise exception 'Escritório da notificação inválido';
      end if;
    else
      raise exception 'Tabela sem regra de escritório: %', tg_table_name;
  end case;

  if v_office is null or v_office <> v_actor_office then
    raise exception 'Registro pertence a outro escritório';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_office_scope() from public, anon, authenticated;

create or replace function private.office_owns_record(p_table text, p_record uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_table
    when 'clients' then exists (select 1 from public.clients c
      where c.id = p_record and c.office_id = private.current_office_id())
    when 'contracts' then exists (select 1 from public.contracts c
      where c.id = p_record and c.office_id = private.current_office_id())
    when 'installments' then exists (select 1 from public.installments i
      join public.contracts c on c.id = i.contract_id
      where i.id = p_record and c.office_id = private.current_office_id())
    when 'payments' then exists (select 1 from public.payments p
      join public.installments i on i.id = p.installment_id
      join public.contracts c on c.id = i.contract_id
      where p.id = p_record and c.office_id = private.current_office_id())
    when 'collection_notes' then exists (select 1 from public.collection_notes n
      join public.clients c on c.id = n.client_id
      where n.id = p_record and c.office_id = private.current_office_id())
    when 'contract_financial_terms' then exists (select 1 from public.contract_financial_terms t
      join public.contracts c on c.id = t.contract_id
      where t.contract_id = p_record and c.office_id = private.current_office_id())
    when 'monthly_closings' then exists (select 1 from public.monthly_closings mc
      join public.profiles p on p.id = mc.lawyer_id
      where mc.id = p_record and p.office_id = private.current_office_id())
    when 'monthly_closing_items' then exists (select 1 from public.monthly_closing_items ci
      join public.monthly_closings mc on mc.id = ci.closing_id
      join public.profiles p on p.id = mc.lawyer_id
      where ci.id = p_record and p.office_id = private.current_office_id())
    when 'closing_adjustments' then exists (select 1 from public.closing_adjustments ca
      join public.monthly_closings mc on mc.id = ca.closing_id
      join public.profiles p on p.id = mc.lawyer_id
      where ca.id = p_record and p.office_id = private.current_office_id())
    when 'commission_transfers' then exists (select 1 from public.commission_transfers ct
      join public.profiles p on p.id = ct.lawyer_id
      where ct.id = p_record and p.office_id = private.current_office_id())
    else false
  end
$$;
revoke all on function private.office_owns_record(text,uuid) from public, anon, authenticated;

drop trigger if exists profiles_office_guard on public.profiles;
create trigger profiles_office_guard before update on public.profiles
  for each row execute function private.enforce_profile_office();
drop trigger if exists clients_office_guard on public.clients;
create trigger clients_office_guard before insert or update on public.clients
  for each row execute function private.enforce_office_scope();
drop trigger if exists contracts_office_guard on public.contracts;
create trigger contracts_office_guard before insert or update on public.contracts
  for each row execute function private.enforce_office_scope();
drop trigger if exists terms_office_guard on public.contract_financial_terms;
create trigger terms_office_guard before insert or update on public.contract_financial_terms
  for each row execute function private.enforce_office_scope();
drop trigger if exists installments_office_guard on public.installments;
create trigger installments_office_guard before insert or update on public.installments
  for each row execute function private.enforce_office_scope();
drop trigger if exists payments_office_guard on public.payments;
create trigger payments_office_guard before insert or update on public.payments
  for each row execute function private.enforce_office_scope();
drop trigger if exists commissions_office_guard on public.commissions;
create trigger commissions_office_guard before insert or update on public.commissions
  for each row execute function private.enforce_office_scope();
drop trigger if exists notes_office_guard on public.collection_notes;
create trigger notes_office_guard before insert or update on public.collection_notes
  for each row execute function private.enforce_office_scope();
drop trigger if exists closings_office_guard on public.monthly_closings;
create trigger closings_office_guard before insert or update on public.monthly_closings
  for each row execute function private.enforce_office_scope();
drop trigger if exists closing_items_office_guard on public.monthly_closing_items;
create trigger closing_items_office_guard before insert or update on public.monthly_closing_items
  for each row execute function private.enforce_office_scope();
drop trigger if exists adjustments_office_guard on public.closing_adjustments;
create trigger adjustments_office_guard before insert or update on public.closing_adjustments
  for each row execute function private.enforce_office_scope();
drop trigger if exists transfers_office_guard on public.commission_transfers;
create trigger transfers_office_guard before insert or update on public.commission_transfers
  for each row execute function private.enforce_office_scope();
drop trigger if exists audit_logs_office_guard on public.audit_logs;
create trigger audit_logs_office_guard before insert or update on public.audit_logs
  for each row execute function private.enforce_office_scope();
drop trigger if exists notifications_office_guard on public.notifications;
create trigger notifications_office_guard before insert or update on public.notifications
  for each row execute function private.enforce_office_scope();

-- O cadastro por contrato passa a localizar CPF apenas dentro do escritório.
do $function_update$
declare v_definition text;
begin
  v_definition := pg_get_functiondef(
    'private.create_lawyer_contract_v2(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint)'::regprocedure);
  v_definition := replace(v_definition,
    'insert into public.clients (full_name, cpf)',
    'insert into public.clients (full_name, cpf, office_id)');
  v_definition := replace(v_definition,
    'values (trim(p_client_name), p_cpf) on conflict (cpf) do nothing;',
    'values (trim(p_client_name), p_cpf, private.current_office_id())' || E'\n' ||
    '    on conflict (office_id, cpf) do nothing;');
  v_definition := replace(v_definition,
    'from public.clients where cpf = p_cpf;',
    'from public.clients where cpf = p_cpf and office_id = private.current_office_id();');
  if v_definition is null or position('on conflict (office_id, cpf)' in v_definition) = 0 or
     position('on conflict (cpf)' in v_definition) > 0 or
     position('office_id = private.current_office_id()' in v_definition) = 0 then
    raise exception 'Não foi possível adaptar create_lawyer_contract_v2 para o escritório';
  end if;
  execute v_definition;
end;
$function_update$;

-- As rotinas SECURITY DEFINER também validam o tenant antes de ler valores,
-- para que uma chamada RPC com UUID de outro escritório não vire um oráculo.
do $rpc_scope$
declare v_definition text;
begin
  v_definition := pg_get_functiondef(
    'private.correct_manager_field(text,uuid,text,text,text)'::regprocedure);
  if position('private.office_owns_record(p_table,p_record)' in v_definition) = 0 then
    if position('if p_record is null or v_new is null or length(v_new) = 0 then' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a correct_manager_field';
    end if;
    v_definition := replace(v_definition,
      'if p_record is null or v_new is null or length(v_new) = 0 then',
      'if not private.office_owns_record(p_table,p_record) then raise exception ''Registro não encontrado''; end if;' || E'\n  ' ||
      'if p_record is null or v_new is null or length(v_new) = 0 then');
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef(
    'private.revise_manager_payment(uuid,text,bigint,date)'::regprocedure);
  if position('private.office_owns_record(''payments'',p_payment)' in v_definition) = 0 then
    if position('select * into v_old from public.payments where id = p_payment for update;' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a revise_manager_payment';
    end if;
    v_definition := replace(v_definition,
      'select * into v_old from public.payments where id = p_payment for update;',
      'if not private.office_owns_record(''payments'',p_payment) then raise exception ''Pagamento indisponível''; end if;' || E'\n  ' ||
      'select * into v_old from public.payments where id = p_payment for update;');
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef(
    'private.revise_secretary_payment(uuid,text,bigint,date)'::regprocedure);
  if position('private.office_owns_record(''payments'',p_payment_id)' in v_definition) = 0 then
    if position('select * into v_payment from public.payments where id = p_payment_id for update;' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a revise_secretary_payment';
    end if;
    v_definition := replace(v_definition,
      'select * into v_payment from public.payments where id = p_payment_id for update;',
      'if not private.office_owns_record(''payments'',p_payment_id) then raise exception ''Pagamento indisponível''; end if;' || E'\n  ' ||
      'select * into v_payment from public.payments where id = p_payment_id for update;');
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef(
    'private.manager_record_payment(uuid,date,bigint,text,text)'::regprocedure);
  if position('where i.id = p_installment and c.office_id = private.current_office_id()' in v_definition) = 0 then
    if position('where i.id = p_installment;' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a manager_record_payment';
    end if;
    v_definition := replace(v_definition,
      'where i.id = p_installment;',
      'where i.id = p_installment and c.office_id = private.current_office_id();');
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef(
    'private.confirm_monthly_closing(uuid,smallint,smallint)'::regprocedure);
  if position('office_id = private.current_office_id()' in v_definition) = 0 then
    if position('where id = p_lawyer and role = ''lawyer''' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a confirm_monthly_closing';
    end if;
    v_definition := replace(v_definition,
      'where id = p_lawyer and role = ''lawyer''',
      'where id = p_lawyer and role = ''lawyer'' and office_id = private.current_office_id()');
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef(
    'private.register_commission_transfer(uuid,bigint,date,text)'::regprocedure);
  if position('private.office_owns_record(''monthly_closings'',p_closing)' in v_definition) = 0 then
    if position('select * into v_closing from public.monthly_closings where id = p_closing for update;' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a register_commission_transfer';
    end if;
    v_definition := replace(v_definition,
      'select * into v_closing from public.monthly_closings where id = p_closing for update;',
      'if not private.office_owns_record(''monthly_closings'',p_closing) then raise exception ''Fechamento indisponível''; end if;' || E'\n  ' ||
      'select * into v_closing from public.monthly_closings where id = p_closing for update;');
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef(
    'private.reverse_commission_transfer(uuid,text)'::regprocedure);
  if position('private.office_owns_record(''commission_transfers'',p_transfer)' in v_definition) = 0 then
    if position('select * into v_transfer from public.commission_transfers where id = p_transfer for update;' in v_definition) = 0 then
      raise exception 'Não foi possível adicionar escopo a reverse_commission_transfer';
    end if;
    v_definition := replace(v_definition,
      'select * into v_transfer from public.commission_transfers where id = p_transfer for update;',
      'if not private.office_owns_record(''commission_transfers'',p_transfer) then raise exception ''Repasse indisponível''; end if;' || E'\n  ' ||
      'select * into v_transfer from public.commission_transfers where id = p_transfer for update;');
  end if;
  execute v_definition;
end;
$rpc_scope$;

revoke all on function private.create_lawyer_contract(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.create_lawyer_contract(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb)
  from public, anon, authenticated;

-- Administração restrita ao escritório de quem executa a ação. Toda mudança
-- de perfil gera log de auditoria transacional com motivo obrigatório.
create or replace function private.manage_office_profile(
  p_user uuid, p_name text, p_role text, p_active boolean,
  p_is_office_admin boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor_office uuid := private.current_office_id();
  v_old public.profiles%rowtype;
  v_lawyer uuid;
begin
  if auth.uid() is null or v_actor_office is null or not private.is_office_admin() then
    raise exception 'Acesso não autorizado';
  end if;
  if p_user is null or length(trim(coalesce(p_name,''))) not between 2 and 160 or
    p_role is null or p_role not in ('lawyer','secretary','manager') or p_active is null or
    p_is_office_admin is null or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Dados inválidos';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_actor_office::text)::bigint);
  select * into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if v_old.office_id is not null and v_old.office_id <> v_actor_office then
    raise exception 'Usuário pertence a outro escritório';
  end if;
  if p_user = auth.uid() and (not p_active or not p_is_office_admin) then
    raise exception 'Não é possível remover o próprio acesso administrativo';
  end if;
  if v_old.office_id = v_actor_office and v_old.active and v_old.is_office_admin and
    (not p_active or not p_is_office_admin) and
    (select count(*) from public.profiles
      where office_id = v_actor_office and active and is_office_admin) <= 1 then
    raise exception 'O último administrador ativo do escritório não pode ser removido';
  end if;
  if v_old.role = 'lawyer' and p_role <> 'lawyer' and (exists
    (select 1 from public.contracts where lawyer_id = p_user) or exists
    (select 1 from public.monthly_closings where lawyer_id = p_user)) then
    raise exception 'Advogada com histórico financeiro deve manter o perfil lawyer';
  end if;
  update public.profiles set full_name = trim(p_name), role = p_role, active = p_active,
    is_office_admin = p_is_office_admin, office_id = v_actor_office where id = p_user;
  v_lawyer := case when p_role = 'lawyer' or v_old.role = 'lawyer' then p_user else null end;
  if v_old.full_name is distinct from trim(p_name) then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'full_name',
      to_jsonb(v_old.full_name),to_jsonb(trim(p_name)),trim(p_reason));
  end if;
  if v_old.role is distinct from p_role then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'role',
      to_jsonb(v_old.role),to_jsonb(p_role),trim(p_reason));
  end if;
  if v_old.active is distinct from p_active then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'active',
      to_jsonb(v_old.active),to_jsonb(p_active),trim(p_reason));
  end if;
  if v_old.is_office_admin is distinct from p_is_office_admin then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'is_office_admin',
      to_jsonb(v_old.is_office_admin),to_jsonb(p_is_office_admin),trim(p_reason));
  end if;
end;
$$;
revoke all on function private.manage_office_profile(uuid,text,text,boolean,boolean,text)
  from public, anon, authenticated;
create or replace function public.manage_office_profile(
  p_user uuid, p_name text, p_role text, p_active boolean,
  p_is_office_admin boolean, p_reason text
) returns void language sql security invoker set search_path = '' as $$
  select private.manage_office_profile(p_user,p_name,p_role,p_active,p_is_office_admin,p_reason);
$$;
revoke all on function public.manage_office_profile(uuid,text,text,boolean,boolean,text)
  from public, anon, authenticated;
grant execute on function private.manage_office_profile(uuid,text,text,boolean,boolean,text),
  public.manage_office_profile(uuid,text,text,boolean,boolean,text) to authenticated;
revoke all on function private.admin_update_profile(uuid,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.admin_update_profile(uuid,text,text,boolean,text) from public, anon, authenticated;

-- Todas as leituras operacionais/financeiras ficam no escritório do usuário.
alter table public.offices enable row level security;
revoke all on table public.offices from anon, authenticated;
grant select on table public.offices to authenticated;
drop policy if exists offices_read on public.offices;
create policy offices_read on public.offices for select to authenticated
  using (id = (select private.current_office_id()));

drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
revoke update on public.profiles from authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (
    office_id = (select private.current_office_id()) and
    ((select private.current_role()) in ('secretary','manager') or
     (select private.is_office_admin()))));

drop policy if exists clients_read on public.clients;
drop policy if exists clients_insert on public.clients;
create policy clients_read on public.clients for select to authenticated using (
  office_id = (select private.current_office_id()) and (
    (select private.current_role()) in ('secretary','manager') or
    ((select private.current_role()) = 'lawyer' and exists (
      select 1 from public.contracts c where c.client_id = clients.id and c.lawyer_id = (select auth.uid())
    ))));
create policy clients_insert on public.clients for insert to authenticated
  with check (office_id = (select private.current_office_id()) and
    (select private.current_role()) in ('secretary','manager'));

drop policy if exists contracts_read on public.contracts;
drop policy if exists contracts_insert on public.contracts;
create policy contracts_read on public.contracts for select to authenticated using (
  office_id = (select private.current_office_id()) and (
    (select private.current_role()) in ('secretary','manager') or
    ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))));
create policy contracts_insert on public.contracts for insert to authenticated
  with check (office_id = (select private.current_office_id()) and
    (select private.current_role()) in ('secretary','manager'));

drop policy if exists terms_read on public.contract_financial_terms;
drop policy if exists terms_insert on public.contract_financial_terms;
create policy terms_read on public.contract_financial_terms for select to authenticated using (
  exists (select 1 from public.contracts c where c.id = contract_id
    and c.office_id = (select private.current_office_id()) and
    ((select private.current_role()) = 'manager' or
     ((select private.current_role()) = 'lawyer' and c.lawyer_id = (select auth.uid())))));
create policy terms_insert on public.contract_financial_terms for insert to authenticated
  with check (exists (select 1 from public.contracts c where c.id = contract_id
    and c.office_id = (select private.current_office_id()) and (select private.current_role()) = 'manager'));

drop policy if exists installments_read on public.installments;
drop policy if exists installments_insert on public.installments;
create policy installments_read on public.installments for select to authenticated using (
  exists (select 1 from public.contracts c where c.id = contract_id
    and c.office_id = (select private.current_office_id()) and
    ((select private.current_role()) in ('secretary','manager') or
     ((select private.current_role()) = 'lawyer' and c.lawyer_id = (select auth.uid())))));
create policy installments_insert on public.installments for insert to authenticated
  with check (exists (select 1 from public.contracts c where c.id = contract_id
    and c.office_id = (select private.current_office_id()) and
    (select private.current_role()) in ('secretary','manager')));

drop policy if exists payments_read on public.payments;
drop policy if exists payments_insert on public.payments;
create policy payments_read on public.payments for select to authenticated using (
  exists (select 1 from public.installments i join public.contracts c on c.id = i.contract_id
    where i.id = installment_id and c.office_id = (select private.current_office_id()) and
    ((select private.current_role()) in ('secretary','manager') or
     ((select private.current_role()) = 'lawyer' and c.lawyer_id = (select auth.uid())))));
create policy payments_insert on public.payments for insert to authenticated with check (
  recorded_by = (select auth.uid()) and (select private.current_role()) = 'secretary' and
  exists (select 1 from public.installments i join public.contracts c on c.id = i.contract_id
    where i.id = installment_id and c.office_id = (select private.current_office_id())));

drop policy if exists commissions_read on public.commissions;
create policy commissions_read on public.commissions for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = lawyer_id
    and p.office_id = (select private.current_office_id())) and
  ((select private.current_role()) = 'manager' or
   ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))));

drop policy if exists notes_read on public.collection_notes;
drop policy if exists notes_insert on public.collection_notes;
create policy notes_read on public.collection_notes for select to authenticated using (
  exists (select 1 from public.clients cl where cl.id = client_id
    and cl.office_id = (select private.current_office_id())) and
  ((select private.current_role()) in ('secretary','manager') or
   ((select private.current_role()) = 'lawyer' and contract_id is not null and exists (
     select 1 from public.contracts c where c.id = contract_id and c.lawyer_id = (select auth.uid())
   ))));
create policy notes_insert on public.collection_notes for insert to authenticated with check (
  author_id = (select auth.uid()) and (select private.current_role()) = 'secretary' and
  exists (select 1 from public.clients cl where cl.id = client_id
    and cl.office_id = (select private.current_office_id())));

drop policy if exists closings_read on public.monthly_closings;
create policy closings_read on public.monthly_closings for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = lawyer_id
    and p.office_id = (select private.current_office_id())) and
  ((select private.current_role()) = 'manager' or
   ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))));

drop policy if exists closing_items_read on public.monthly_closing_items;
create policy closing_items_read on public.monthly_closing_items for select to authenticated using (
  exists (select 1 from public.monthly_closings mc join public.profiles p on p.id = mc.lawyer_id
    where mc.id = closing_id and p.office_id = (select private.current_office_id()) and
    ((select private.current_role()) = 'manager' or
     ((select private.current_role()) = 'lawyer' and mc.lawyer_id = (select auth.uid())))));
drop policy if exists closing_adjustments_read on public.closing_adjustments;
create policy closing_adjustments_read on public.closing_adjustments for select to authenticated using (
  exists (select 1 from public.monthly_closings mc join public.profiles p on p.id = mc.lawyer_id
    where mc.id = closing_id and p.office_id = (select private.current_office_id()) and
    ((select private.current_role()) = 'manager' or
     ((select private.current_role()) = 'lawyer' and mc.lawyer_id = (select auth.uid())))));
drop policy if exists transfers_read on public.commission_transfers;
create policy transfers_read on public.commission_transfers for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = lawyer_id
    and p.office_id = (select private.current_office_id())) and
  ((select private.current_role()) = 'manager' or
   ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))));

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (
  office_id = (select private.current_office_id()) and
  ((select private.current_role()) = 'manager' or
   ((select private.current_role()) = 'lawyer' and affected_lawyer_id = (select auth.uid()))));
drop policy if exists notifications_read on public.notifications;
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  office_id = (select private.current_office_id()) and
  (user_id = (select auth.uid()) or (select private.current_role()) in ('secretary','manager')));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and office_id = (select private.current_office_id()))
  with check (user_id = (select auth.uid()) and office_id = (select private.current_office_id()));

-- PDFs seguem o escopo do escritório e o contrato relacionado.
drop policy if exists contract_pdf_lawyer_upload on storage.objects;
drop policy if exists contract_pdf_read on storage.objects;
drop policy if exists contract_pdf_cleanup on storage.objects;
create policy contract_pdf_lawyer_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'contract-pdfs' and (select private.current_role()) = 'lawyer' and
  owner_id = (select auth.uid())::text and
  storage.foldername(name) = array['contracts',(select auth.uid())::text,(storage.foldername(name))[3]] and
  array_length(storage.foldername(name),1) = 3 and
  (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
  storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$');
create policy contract_pdf_read on storage.objects for select to authenticated using (
  bucket_id = 'contract-pdfs' and (
    ((select private.current_role()) = 'lawyer' and
      (storage.foldername(name))[2] = (select auth.uid())::text and
      (owner_id = (select auth.uid())::text or exists (select 1 from public.contracts c
        where c.contract_file_path = name and c.lawyer_id = (select auth.uid())
          and c.office_id = (select private.current_office_id())))) or
    ((select private.current_role()) in ('secretary','manager') and exists (
      select 1 from public.contracts c where c.contract_file_path = name
        and c.office_id = (select private.current_office_id())))));
create policy contract_pdf_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'contract-pdfs' and (select private.current_role()) = 'lawyer' and
  owner_id = (select auth.uid())::text and (storage.foldername(name))[2] = (select auth.uid())::text and
  not exists (select 1 from public.contracts c where c.contract_file_path = name));

do $postflight$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='clients_office_cpf_unique') or
    not exists (select 1 from pg_policies where schemaname='public' and tablename='contracts'
      and policyname='contracts_read') or
    to_regprocedure('public.manage_office_profile(uuid,text,text,boolean,boolean,text)') is null or
    to_regprocedure('private.current_office_id()') is null then
    raise exception 'Migration multi-escritório incompleta';
  end if;
end;
$postflight$;

commit;
