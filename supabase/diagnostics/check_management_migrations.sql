-- Execute no Supabase SQL Editor. Apenas consulta o estado das duas migrations
-- de gestão; não altera dados, permissões ou histórico de migrations.
with checks(migration, item, present) as (
  values
    ('20261002000100', 'monthly_closing_items', to_regclass('public.monthly_closing_items') is not null),
    ('20261002000100', 'closing_adjustments', to_regclass('public.closing_adjustments') is not null),
    ('20261002000100', 'commission_transfers', to_regclass('public.commission_transfers') is not null),
    ('20261002000100', 'monthly_closings.adjustment_amount', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'monthly_closings'
        and column_name = 'adjustment_amount')),
    ('20261002000100', 'private.revise_manager_payment',
      to_regprocedure('private.revise_manager_payment(uuid,text,bigint,date)') is not null),
    ('20261002000100', 'public.revise_manager_payment',
      to_regprocedure('public.revise_manager_payment(uuid,text,bigint,date)') is not null),
    ('20261002000100', 'public.correct_manager_field',
      to_regprocedure('public.correct_manager_field(text,uuid,text,text,text)') is not null),
    ('20261002000100', 'public.admin_update_profile',
      to_regprocedure('public.admin_update_profile(uuid,text,text,boolean,text)') is not null),
    ('20261002000100', 'authenticated EXECUTE public.admin_update_profile', exists (
      select 1 from pg_roles r
      where r.rolname = 'authenticated' and has_function_privilege(r.oid,
        to_regprocedure('public.admin_update_profile(uuid,text,text,boolean,text)'), 'EXECUTE'))),
    ('20261002000100', 'authenticated EXECUTE private.admin_update_profile', exists (
      select 1 from pg_roles r
      where r.rolname = 'authenticated' and has_function_privilege(r.oid,
        to_regprocedure('private.admin_update_profile(uuid,text,text,boolean,text)'), 'EXECUTE'))),
    ('20261002000100', 'transfers_read policy', exists (
      select 1 from pg_policies where schemaname = 'public'
        and tablename = 'commission_transfers' and policyname = 'transfers_read')),
    ('20261002000200', 'payments_guard_closed_month trigger', exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.payments')
        and tgname = 'payments_guard_closed_month' and not tgisinternal)),
    ('20261002000200', 'payments_guard_closed_void trigger', exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.payments')
        and tgname = 'payments_guard_closed_void' and not tgisinternal)),
    ('20261002000200', 'payments_audit_creation trigger', exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.payments')
        and tgname = 'payments_audit_creation' and not tgisinternal)),
    ('20261002000200', 'contracts_audit_creation trigger', exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.contracts')
        and tgname = 'contracts_audit_creation' and not tgisinternal)),
    ('20261002000200', 'notes_audit_creation trigger', exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.collection_notes')
        and tgname = 'notes_audit_creation' and not tgisinternal)),
    ('20261002000200', 'public.manager_record_payment',
      to_regprocedure('public.manager_record_payment(uuid,date,bigint,text,text)') is not null),
    ('20261002000200', 'authenticated EXECUTE public.manager_record_payment', exists (
      select 1 from pg_roles r
      where r.rolname = 'authenticated' and has_function_privilege(r.oid,
        to_regprocedure('public.manager_record_payment(uuid,date,bigint,text,text)'), 'EXECUTE'))),
    ('20261002000200', 'authenticated EXECUTE private.manager_record_payment', exists (
      select 1 from pg_roles r
      where r.rolname = 'authenticated' and has_function_privilege(r.oid,
        to_regprocedure('private.manager_record_payment(uuid,date,bigint,text,text)'), 'EXECUTE'))),
    ('20261002000200', 'private.revise_manager_payment updated', coalesce(
      pg_get_functiondef(to_regprocedure('private.revise_manager_payment(uuid,text,bigint,date)'))
        like '%app.manager_payment_correction%', false))
)
select migration,
  count(*) as itens_verificados,
  count(*) filter (where present) as itens_presentes,
  coalesce(string_agg(item, ', ' order by item) filter (where not present), 'nenhum')
    as itens_ausentes
from checks
group by migration
order by migration;
