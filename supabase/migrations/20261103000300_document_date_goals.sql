-- Metas passam a usar a data de contratação do documento.
-- Não altera confirmações, datas, contratos ou metas existentes.
begin;
create index if not exists contracts_goal_document_date on public.contracts(office_id,lawyer_id,contract_date)
  where deleted_at is null and engagement_status<>'cancelled';

create or replace function public.contract_goal_summary(p_scope text,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_office uuid:=private.current_office_id();
  v_today date:=(current_timestamp at time zone 'America/Sao_Paulo')::date;
  v_cutoff date; v_previous date; v_previous_cutoff date; v_result jsonb;
begin
  if v_actor is null or v_office is null or p_scope is null or
    (p_scope='individual' and private.current_role() is distinct from 'lawyer') or
    (p_scope='office' and not (private.is_office_admin() or private.current_role()='manager')) or
    p_scope not in ('individual','office') then raise exception 'Acesso não autorizado'; end if;
  if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01'::date or
    p_month>date_trunc('month',v_today)::date then raise exception 'Selecione um mês anterior ou o mês atual'; end if;
  v_cutoff:=least((p_month+interval '1 month - 1 day')::date,v_today);
  v_previous:=(p_month-interval '1 month')::date;
  v_previous_cutoff:=case when p_month=date_trunc('month',v_today)::date then
    least((p_month-1)::date,v_previous+(extract(day from v_today)::integer-1)) else p_month-1 end;
  with scoped as materialized (
    select c.id,c.contract_date from public.contracts c where c.office_id=v_office and c.deleted_at is null
      and c.engagement_status<>'cancelled' and c.contract_date<=v_today
      and (p_scope='office' or c.lawyer_id=v_actor)
  ), first_record as (select min(contract_date) as starts from scoped), periods as (
    select generate_series(p_month-interval '5 months',p_month,interval '1 month')::date as month
  ), history as (
    select to_char(m.month,'YYYY-MM') as month,
      (select count(*) from scoped s where s.contract_date>=m.month and s.contract_date<(m.month+interval '1 month')) as count,
      coalesce(f.starts<(m.month+interval '1 month'),false) as has_history,
      case when p_scope='individual' then (select target_contract_count from public.lawyer_monthly_goals g
        where g.lawyer_id=v_actor and g.office_id=v_office and g.reference_month=m.month)
      else (select target_contract_count from public.office_monthly_goals g where g.office_id=v_office and g.reference_month=m.month) end as target
    from periods m cross join first_record f
  ), previous_months as (
    select date_trunc('month',contract_date)::date as month,count(*) as count from scoped where contract_date<p_month group by 1
  ) select jsonb_build_object(
    'month',to_char(p_month,'YYYY-MM'),'scope',p_scope,'as_of',v_cutoff,'count_basis','contract_date',
    'count',(select count(*) from scoped where contract_date>=p_month and contract_date<=v_cutoff),
    'previous_count',(select count(*) from scoped where contract_date>=v_previous and contract_date<=v_previous_cutoff),
    'previous_until',v_previous_cutoff,
    'comparison_available',(select coalesce(starts<p_month,false) from first_record),
    'best_previous_count',(select max(count) from previous_months),
    'pending_count',0,
    'history',(select jsonb_agg(to_jsonb(h) order by h.month) from history h),
    'goal_updated_at',case when p_scope='individual' then (select updated_at from public.lawyer_monthly_goals
      where lawyer_id=v_actor and office_id=v_office and reference_month=p_month)
      else (select updated_at from public.office_monthly_goals where office_id=v_office and reference_month=p_month) end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.contract_goal_summary(text,date) from public,anon,authenticated;
grant execute on function public.contract_goal_summary(text,date) to authenticated;

-- Acompanhamento somente de leitura para gestores do próprio escritório.
create or replace function public.team_contract_goals(p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_office uuid:=private.current_office_id();
  v_today date:=(current_timestamp at time zone 'America/Sao_Paulo')::date;
  v_until date; v_previous date; v_previous_until date; v_rows jsonb;
begin
  if auth.uid() is null or v_office is null or private.current_role() is distinct from 'manager' then
    raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01'::date or
    p_month>date_trunc('month',v_today)::date then raise exception 'Selecione um mês anterior ou o mês atual'; end if;
  v_until:=least((p_month+interval '1 month - 1 day')::date,v_today);
  v_previous:=(p_month-interval '1 month')::date;
  v_previous_until:=case when p_month=date_trunc('month',v_today)::date then
    least(p_month-1,v_previous+(extract(day from v_today)::integer-1)) else p_month-1 end;
  with counts as (
    select c.lawyer_id,
      count(*) filter(where c.contract_date between p_month and v_until) as count,
      count(*) filter(where c.contract_date between v_previous and v_previous_until) as previous_count
    from public.contracts c where c.office_id=v_office and c.deleted_at is null and c.engagement_status<>'cancelled'
      and c.contract_date between v_previous and v_until group by c.lawyer_id
  ), members as (
    select p.id as lawyer_id,p.full_name,p.active,coalesce(c.count,0) as count,coalesce(c.previous_count,0) as previous_count,
      g.target_contract_count as target
    from public.profiles p left join counts c on c.lawyer_id=p.id
    left join public.lawyer_monthly_goals g on g.lawyer_id=p.id and g.office_id=v_office and g.reference_month=p_month
    where p.office_id=v_office and ((p.role='lawyer' and p.active) or c.lawyer_id is not null or g.lawyer_id is not null)
  ) select coalesce(jsonb_agg(to_jsonb(m) order by m.full_name,m.lawyer_id),'[]'::jsonb) into v_rows from members m;
  return jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'as_of',v_until,'previous_until',v_previous_until,'members',v_rows);
end;
$$;
revoke all on function public.team_contract_goals(date) from public,anon,authenticated;
grant execute on function public.team_contract_goals(date) to authenticated;
notify pgrst,'reload schema';
commit;
