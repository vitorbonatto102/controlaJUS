-- Metas individuais de contratos fechados. Aplicar após 20261026000100.
-- Não altera contratos, comissões, parcelas, pagamentos ou fechamentos.
begin;

create table if not exists public.lawyer_monthly_goals (
  lawyer_id uuid not null references public.profiles(id),
  office_id uuid not null references public.offices(id),
  reference_month date not null check (extract(day from reference_month)=1
    and reference_month between '2000-01-01'::date and '2100-12-01'::date),
  target_contract_count integer not null check (target_contract_count between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lawyer_id,reference_month)
);
create index if not exists lawyer_goals_office_month
  on public.lawyer_monthly_goals(office_id,reference_month);
comment on table public.lawyer_monthly_goals is
  'Meta de quantidade de contratos assinados por advogada/mês; progresso vem da data dos contratos cadastrados.';
alter table public.lawyer_monthly_goals enable row level security;
revoke all on public.lawyer_monthly_goals from anon,authenticated;
grant select on public.lawyer_monthly_goals to authenticated;

drop policy if exists contract_goals_read on public.lawyer_monthly_goals;
create policy contract_goals_read on public.lawyer_monthly_goals for select to authenticated using (
  office_id=(select private.current_office_id()) and
  ((lawyer_id=(select auth.uid()) and (select private.current_role())='lawyer') or
    (select private.current_role())='manager')
);

-- Nenhum lawyer_id/office_id é aceito do cliente. Escrita somente por esta RPC.
create or replace function public.save_my_contract_goal(p_month date,p_target integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_office uuid:=private.current_office_id();
begin
  if v_actor is null or v_office is null or private.current_role() is distinct from 'lawyer' then
    raise exception 'Acesso não autorizado'; end if;
  if p_month is null or extract(day from p_month)<>1 or
    p_month not between '2000-01-01'::date and '2100-12-01'::date or
    p_target is null or p_target not between 1 and 10000 then
    raise exception 'Informe um mês e uma quantidade de contratos válidos'; end if;
  insert into public.lawyer_monthly_goals(lawyer_id,office_id,reference_month,target_contract_count)
    values(v_actor,v_office,p_month,p_target)
    on conflict(lawyer_id,reference_month) do update
      set target_contract_count=excluded.target_contract_count,updated_at=now()
      where public.lawyer_monthly_goals.office_id=v_office;
  if not found then raise exception 'Meta pertence a outro escritório'; end if;
end;
$$;
revoke all on function public.save_my_contract_goal(date,integer) from public,anon,authenticated;
grant execute on function public.save_my_contract_goal(date,integer) to authenticated;

notify pgrst,'reload schema';
commit;
