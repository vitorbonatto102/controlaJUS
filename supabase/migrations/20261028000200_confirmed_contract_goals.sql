-- Metas comerciais: confirmação explícita, data efetiva e escopo de escritório.
-- Aplicar após 20261028000100. Nenhum contrato legado é confirmado por inferência.
begin;
alter table public.contracts
  add column if not exists engagement_status text not null default 'unconfirmed',
  add column if not exists closed_on date;
alter table public.contracts drop constraint if exists contracts_engagement_check;
alter table public.contracts add constraint contracts_engagement_check check (
  (engagement_status='confirmed' and closed_on is not null and closed_on>='1900-01-01'::date) or
  (engagement_status in ('unconfirmed','cancelled') and closed_on is null)
);
comment on column public.contracts.closed_on is 'Data efetiva da contratação confirmada/assinada, informada explicitamente. Não é created_at nem a data do documento.';
comment on column public.contracts.lawyer_id is 'Advogada responsável principal. É a atribuição individual para metas; contratantes adicionais não recebem atribuição comercial.';
create index if not exists contracts_office_confirmed_date on public.contracts(office_id,closed_on,lawyer_id)
  where engagement_status='confirmed' and deleted_at is null;

create or replace function private.guard_contract_engagement() returns trigger
language plpgsql set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op='INSERT' then
    if new.engagement_status<>'unconfirmed' or new.closed_on is not null then
      raise exception 'Confirme a contratação pelo fluxo específico após o cadastro'; end if;
  elsif new.engagement_status is distinct from old.engagement_status or new.closed_on is distinct from old.closed_on then
    if current_setting('app.contract_engagement_change',true) is distinct from 'on' then
      raise exception 'Altere a confirmação pelo fluxo auditado de contratação'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_contract_engagement() from public,anon,authenticated;
drop trigger if exists contracts_engagement_guard on public.contracts;
create trigger contracts_engagement_guard before insert or update of engagement_status,closed_on on public.contracts
  for each row execute function private.guard_contract_engagement();

create or replace function public.set_contract_engagement(p_contract uuid,p_expected_version timestamptz,
  p_status text,p_closed_on date,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_old public.contracts%rowtype; v_actor uuid:=auth.uid(); v_office uuid:=private.current_office_id();
  v_context text:=current_setting('app.contract_engagement_change',true);
begin
  if v_actor is null or v_office is null or private.current_role() not in ('lawyer','manager') then
    raise exception 'Acesso não autorizado'; end if;
  if p_status is null or p_status not in ('unconfirmed','confirmed','cancelled') or
    length(trim(coalesce(p_reason,''))) not between 5 and 1000 or p_expected_version is null then
    raise exception 'Confira a situação e informe o motivo da alteração'; end if;
  if (p_status='confirmed' and (p_closed_on is null or p_closed_on<'1900-01-01'::date or
    p_closed_on>(current_timestamp at time zone 'America/Sao_Paulo')::date)) or
    (p_status<>'confirmed' and p_closed_on is not null) then
    raise exception 'Informe a data efetiva da contratação, sem data futura'; end if;
  perform private.lock_commission_record('contracts',p_contract);
  select * into v_old from public.contracts where id=p_contract and office_id=v_office and deleted_at is null
    and (lawyer_id=v_actor or private.current_role()='manager') for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if v_old.updated_at is distinct from p_expected_version then
    raise exception 'O contrato mudou. Recarregue a página antes de confirmar'; end if;
  if v_old.engagement_status=p_status and v_old.closed_on is not distinct from p_closed_on then return; end if;
  perform set_config('app.contract_engagement_change','on',true);
  update public.contracts set engagement_status=p_status,closed_on=p_closed_on where id=p_contract;
  perform set_config('app.contract_engagement_change',coalesce(v_context,''),true);
  insert into public.audit_logs(office_id,user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(v_office,v_actor,v_old.lawyer_id,'contracts',p_contract,'engagement_confirmation',
      jsonb_build_object('status',v_old.engagement_status,'closed_on',v_old.closed_on),
      jsonb_build_object('status',p_status,'closed_on',p_closed_on),trim(p_reason));
  if private.current_role()='manager' and v_actor<>v_old.lawyer_id then
    insert into public.notifications(office_id,user_id,type,title,message,related_record_id)
      values(v_office,v_old.lawyer_id,'manager_correction','Confirmação da contratação atualizada',
        'O gestor atualizou a confirmação comercial de um contrato sob sua responsabilidade. Situação: ' ||
        case p_status when 'confirmed' then 'confirmada em '||to_char(p_closed_on,'DD/MM/YYYY')
          when 'cancelled' then 'cancelada' else 'aguardando confirmação' end ||
        '. Motivo: '||trim(p_reason),p_contract);
  end if;
end;
$$;
revoke all on function public.set_contract_engagement(uuid,timestamptz,text,date,text) from public,anon,authenticated;
grant execute on function public.set_contract_engagement(uuid,timestamptz,text,date,text) to authenticated;

create table if not exists public.office_monthly_goals (
  id uuid not null unique default gen_random_uuid(),
  office_id uuid not null references public.offices(id),
  reference_month date not null check (extract(day from reference_month)=1 and reference_month between '2000-01-01'::date and '2100-12-01'::date),
  target_contract_count integer not null check (target_contract_count between 1 and 10000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(office_id,reference_month)
);
alter table public.office_monthly_goals enable row level security;
revoke all on public.office_monthly_goals from anon,authenticated;
grant select on public.office_monthly_goals to authenticated;
drop policy if exists office_goals_read on public.office_monthly_goals;
create policy office_goals_read on public.office_monthly_goals for select to authenticated using (
  office_id=(select private.current_office_id()) and
  ((select private.is_office_admin()) or (select private.current_role())='manager')
);

create or replace function public.save_office_contract_goal(p_month date,p_target integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_office uuid:=private.current_office_id(); v_old integer; v_id uuid;
begin
  if auth.uid() is null or v_office is null or not private.is_office_admin() then raise exception 'Acesso não autorizado'; end if;
  if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01'::date or
    p_month>date_trunc('month',current_timestamp at time zone 'America/Sao_Paulo')::date or
    p_target is null or p_target not between 1 and 10000 then raise exception 'Confira o mês e a meta de contratos'; end if;
  perform pg_advisory_xact_lock(hashtextextended('office-goal:'||v_office::text||p_month::text,0));
  select id,target_contract_count into v_id,v_old from public.office_monthly_goals where office_id=v_office and reference_month=p_month;
  insert into public.office_monthly_goals(office_id,reference_month,target_contract_count) values(v_office,p_month,p_target)
    on conflict(office_id,reference_month) do update set target_contract_count=excluded.target_contract_count,updated_at=now()
    returning id into v_id;
  if v_old is distinct from p_target then
    insert into public.audit_logs(office_id,user_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(v_office,auth.uid(),'office_monthly_goals',v_id,'target_contract_count',to_jsonb(v_old),
        jsonb_build_object('month',p_month,'target',p_target),'Meta mensal do escritório atualizada');
  end if;
end;
$$;
revoke all on function public.save_office_contract_goal(date,integer) from public,anon,authenticated;
grant execute on function public.save_office_contract_goal(date,integer) to authenticated;

-- Mantém a RPC individual existente e acrescenta período válido e auditoria.
create or replace function public.save_my_contract_goal(p_month date,p_target integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_office uuid:=private.current_office_id(); v_old integer;
begin
  if v_actor is null or v_office is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01'::date or
    p_month>date_trunc('month',current_timestamp at time zone 'America/Sao_Paulo')::date or
    p_target is null or p_target not between 1 and 10000 then raise exception 'Informe um mês e uma quantidade de contratos válidos'; end if;
  perform pg_advisory_xact_lock(hashtextextended('personal-goal:'||v_actor::text||p_month::text,0));
  select target_contract_count into v_old from public.lawyer_monthly_goals where lawyer_id=v_actor and reference_month=p_month and office_id=v_office;
  insert into public.lawyer_monthly_goals(lawyer_id,office_id,reference_month,target_contract_count) values(v_actor,v_office,p_month,p_target)
    on conflict(lawyer_id,reference_month) do update set target_contract_count=excluded.target_contract_count,updated_at=now()
      where public.lawyer_monthly_goals.office_id=v_office;
  if not found then raise exception 'Meta pertence a outro escritório'; end if;
  if v_old is distinct from p_target then
    insert into public.audit_logs(office_id,user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(v_office,v_actor,v_actor,'lawyer_monthly_goals',v_actor,'target_contract_count',to_jsonb(v_old),
        jsonb_build_object('month',p_month,'target',p_target),'Meta individual mensal atualizada');
  end if;
end;
$$;
revoke all on function public.save_my_contract_goal(date,integer) from public,anon,authenticated;
grant execute on function public.save_my_contract_goal(date,integer) to authenticated;

-- Somente agregados. O escopo coletivo não revela clientes ou contratos de colegas.
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
    select c.id,c.closed_on from public.contracts c where c.office_id=v_office and c.deleted_at is null
      and c.engagement_status='confirmed' and c.closed_on<=v_today
      and (p_scope='office' or c.lawyer_id=v_actor)
  ), first_record as (select min(closed_on) as starts from scoped), periods as (
    select generate_series(p_month-interval '5 months',p_month,interval '1 month')::date as month
  ), history as (
    select to_char(m.month,'YYYY-MM') as month,
      (select count(*) from scoped s where s.closed_on>=m.month and s.closed_on<(m.month+interval '1 month')) as count,
      coalesce(f.starts<(m.month+interval '1 month'),false) as has_history,
      case when p_scope='individual' then (select target_contract_count from public.lawyer_monthly_goals g
        where g.lawyer_id=v_actor and g.office_id=v_office and g.reference_month=m.month)
      else (select target_contract_count from public.office_monthly_goals g where g.office_id=v_office and g.reference_month=m.month) end as target
    from periods m cross join first_record f
  ), previous_months as (
    select date_trunc('month',closed_on)::date as month,count(*) as count from scoped where closed_on<p_month group by 1
  ) select jsonb_build_object(
    'month',to_char(p_month,'YYYY-MM'),'scope',p_scope,'as_of',v_cutoff,
    'count',(select count(*) from scoped where closed_on>=p_month and closed_on<=v_cutoff),
    'previous_count',(select count(*) from scoped where closed_on>=v_previous and closed_on<=v_previous_cutoff),
    'previous_until',v_previous_cutoff,
    'comparison_available',(select coalesce(starts<p_month,false) from first_record),
    'best_previous_count',(select max(count) from previous_months),
    'pending_count',(select count(*) from public.contracts c where c.office_id=v_office and c.deleted_at is null
      and c.engagement_status='unconfirmed' and (p_scope='office' or c.lawyer_id=v_actor)),
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
notify pgrst,'reload schema';
commit;
