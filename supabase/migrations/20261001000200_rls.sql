-- Controle de acesso por linha + privilégios explícitos. A service_role ignora RLS:
-- nunca a use no browser nem em rotas comuns da aplicação.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.current_role() returns text language sql stable security definer
set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active = true
$$;
revoke all on function private.current_role() from public;
grant execute on function private.current_role() to authenticated;

-- Reduz a superfície de funções de trigger SECURITY DEFINER.
revoke all on function public.handle_auth_user() from public, anon, authenticated;
revoke all on function public.sync_auth_email() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.assert_lawyer() from public, anon, authenticated;
revoke all on function public.ensure_note_contract_client() from public, anon, authenticated;
revoke all on function public.set_actor() from public, anon, authenticated;
revoke all on function public.reject_audit_mutation() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_financial_terms enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.commissions enable row level security;
alter table public.collection_notes enable row level security;
alter table public.monthly_closings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.profiles, public.clients, public.contracts,
  public.contract_financial_terms, public.installments, public.payments,
  public.commissions, public.collection_notes, public.monthly_closings,
  public.audit_logs, public.notifications from anon, authenticated;

grant select on table public.profiles, public.clients, public.contracts,
  public.contract_financial_terms, public.installments, public.payments,
  public.commissions, public.collection_notes, public.monthly_closings,
  public.audit_logs, public.notifications to authenticated;

-- Sem UPDATE/DELETE de registros financeiros ou operacionais nesta etapa.
-- O fluxo posterior de correção deve gravar motivo, diff, auditoria e notificação
-- em uma única transação antes de receber permissões de escrita adicionais.
grant insert on table public.clients, public.contracts, public.contract_financial_terms,
  public.installments, public.payments, public.collection_notes to authenticated;
grant update (full_name, role, active) on table public.profiles to authenticated;
grant update (read_at) on table public.notifications to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.current_role()) in ('secretary','manager','admin'));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy clients_read on public.clients for select to authenticated
  using (
    (select private.current_role()) in ('secretary','manager','admin')
    or ((select private.current_role()) = 'lawyer' and exists (
      select 1 from public.contracts c where c.client_id = id and c.lawyer_id = (select auth.uid())
    ))
  );
create policy clients_insert on public.clients for insert to authenticated
  with check ((select private.current_role()) in ('secretary','manager','admin'));

create policy contracts_read on public.contracts for select to authenticated
  using (
    (select private.current_role()) in ('secretary','manager','admin')
    or ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))
  );
create policy contracts_insert on public.contracts for insert to authenticated
  with check ((select private.current_role()) in ('secretary','manager','admin'));

create policy terms_read on public.contract_financial_terms for select to authenticated
  using (
    (select private.current_role()) in ('manager','admin')
    or ((select private.current_role()) = 'lawyer' and exists (
      select 1 from public.contracts c where c.id = contract_id and c.lawyer_id = (select auth.uid())
    ))
  );
create policy terms_insert on public.contract_financial_terms for insert to authenticated
  with check ((select private.current_role()) in ('manager','admin'));

create policy installments_read on public.installments for select to authenticated
  using (
    (select private.current_role()) in ('secretary','manager','admin')
    or ((select private.current_role()) = 'lawyer' and exists (
      select 1 from public.contracts c where c.id = contract_id and c.lawyer_id = (select auth.uid())
    ))
  );
create policy installments_insert on public.installments for insert to authenticated
  with check ((select private.current_role()) in ('secretary','manager','admin'));

create policy payments_read on public.payments for select to authenticated
  using (
    (select private.current_role()) in ('secretary','manager','admin')
    or ((select private.current_role()) = 'lawyer' and exists (
      select 1 from public.installments i
      join public.contracts c on c.id = i.contract_id
      where i.id = installment_id and c.lawyer_id = (select auth.uid())
    ))
  );
create policy payments_insert on public.payments for insert to authenticated
  with check ((select private.current_role()) in ('secretary','manager','admin')
    and recorded_by = (select auth.uid()));

create policy commissions_read on public.commissions for select to authenticated
  using (
    (select private.current_role()) in ('manager','admin')
    or ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))
  );
-- Nenhuma política INSERT: o cálculo será implementado em transação segura futura.

create policy notes_read on public.collection_notes for select to authenticated
  using (
    (select private.current_role()) in ('secretary','manager','admin')
    or ((select private.current_role()) = 'lawyer' and contract_id is not null and exists (
      select 1 from public.contracts c where c.id = contract_id and c.lawyer_id = (select auth.uid())
    ))
  );
create policy notes_insert on public.collection_notes for insert to authenticated
  with check ((select private.current_role()) in ('secretary','manager','admin')
    and author_id = (select auth.uid()));

create policy closings_read on public.monthly_closings for select to authenticated
  using (
    (select private.current_role()) in ('manager','admin')
    or ((select private.current_role()) = 'lawyer' and lawyer_id = (select auth.uid()))
  );

create policy audit_read on public.audit_logs for select to authenticated
  using (
    (select private.current_role()) in ('manager','admin')
    or ((select private.current_role()) = 'lawyer' and affected_lawyer_id = (select auth.uid()))
  );
-- Nunca conceder INSERT, UPDATE ou DELETE direto em audit_logs.

create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (select private.current_role()) in ('manager','admin'));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select private.current_role()) is not null)
  with check (user_id = (select auth.uid()) and (select private.current_role()) is not null);
