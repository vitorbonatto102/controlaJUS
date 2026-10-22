-- Corrige o cadastro após a migração multi-escritório: a inferência de um
-- índice UNIQUE parcial exige seu predicado no alvo do ON CONFLICT.
-- Mantém o CPF único por escritório e preserva dados, RLS, assinatura e grants.
begin;

do $repair$
declare
  v_function regprocedure := to_regprocedure(
    'private.create_lawyer_contract_v2(uuid,text,text,date,bigint,text,smallint,text,text,text,jsonb,text,date,text,integer,bigint,boolean,numeric,text,bigint,bigint)');
  v_definition text;
begin
  if v_function is null or not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('public.clients_office_cpf_unique')
      and i.indisunique and i.indisvalid and i.indnkeyatts = 2
      and pg_get_indexdef(i.indexrelid, 1, true) = 'office_id'
      and pg_get_indexdef(i.indexrelid, 2, true) = 'cpf'
      and lower(regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[[:space:]()]', '', 'g')) = 'cpfisnotnull'
  ) then
    raise exception 'Aplique primeiro a migration multi-escritório 20261006000100_offices_rbac.sql';
  end if;

  v_definition := pg_get_functiondef(v_function);
  if position('insert into public.clients (full_name, cpf, office_id)' in v_definition) = 0 or
     position('office_id = private.current_office_id()' in v_definition) = 0 then
    raise exception 'A rotina de cadastro ainda não está adaptada para múltiplos escritórios';
  end if;

  -- A condição opcional torna a correção reaplicável no SQL Editor.
  v_definition := regexp_replace(v_definition,
    'on\s+conflict\s*\(\s*office_id\s*,\s*cpf\s*\)\s*(where\s+cpf\s+is\s+not\s+null\s+)?do\s+nothing',
    'on conflict (office_id, cpf) where cpf is not null do nothing', 'i');
  if position('on conflict (office_id, cpf) where cpf is not null do nothing' in v_definition) = 0 then
    raise exception 'Não foi possível corrigir o alvo ON CONFLICT do cadastro';
  end if;
  execute v_definition;
end;
$repair$;

commit;
