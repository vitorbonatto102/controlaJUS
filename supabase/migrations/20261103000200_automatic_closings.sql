-- Automação e correções preservam snapshots, ajustes, auditoria e retenção existentes.
begin;
alter table public.monthly_closings add column if not exists automatic boolean not null default false;
alter table public.audit_logs alter column user_id drop not null;
alter table public.audit_logs add column if not exists actor_kind text not null default 'user';
do $$ begin
  if not exists(select 1 from pg_constraint where conname='audit_actor_kind_check' and conrelid='public.audit_logs'::regclass) then
    alter table public.audit_logs add constraint audit_actor_kind_check check (
      (actor_kind='user' and user_id is not null) or
      (actor_kind='system' and user_id is null and table_name='monthly_closings' and field_name='automatic_closing'));
  end if;
end $$;

create or replace function private.run_automatic_closings(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare v_month date; v_end date; v_local timestamp:=p_now at time zone 'America/Sao_Paulo';
  v_last date; v_lawyer record; v_id uuid; v_count integer:=0;
begin
  -- Apenas o proprietário do banco/job. Nunca disponível como RPC autenticada.
  if auth.uid() is not null then raise exception 'Rotina exclusiva do agendador'; end if;
  perform pg_advisory_xact_lock(hashtext('repassum:automatic_closings'));
  v_last:=date_trunc('month',v_local)::date-1;
  if v_local::date=(date_trunc('month',v_local)+interval '1 month - 1 day')::date
    and v_local::time >= '23:59'::time then v_last:=v_local::date; end if;
  for v_month in select generate_series('2026-10-01'::date,date_trunc('month',v_last)::date,interval '1 month')::date loop
    v_end:=(v_month+interval '1 month')::date;
    for v_lawyer in select p.id,p.office_id from public.profiles p where p.role='lawyer' and p.office_id is not null
      and (p.created_at < (v_end::timestamp at time zone 'America/Sao_Paulo') or exists(
        select 1 from public.contracts c where c.lawyer_id=p.id and c.contract_date<v_end)) order by p.id loop
      perform private.lock_lawyer_finance(v_lawyer.id);
      perform pg_advisory_xact_lock(hashtext(v_lawyer.id::text||v_month::text));
      select id into v_id from public.monthly_closings where lawyer_id=v_lawyer.id
        and reference_year=extract(year from v_month) and reference_month=extract(month from v_month) for update;
      if found then
        -- Nunca sobrescrever um fechamento já confirmado, manual ou automático.
        if exists(select 1 from public.monthly_closings where id=v_id and status<>'draft') then continue; end if;
        if exists(select 1 from public.monthly_closing_items where closing_id=v_id) then
          raise exception 'Apuração com composição inesperada: %',v_id; end if;
        update public.monthly_closings set status='closed',closed_at=p_now,automatic=true where id=v_id;
      else
        insert into public.monthly_closings(lawyer_id,reference_month,reference_year,status,closed_at,automatic)
          values(v_lawyer.id,extract(month from v_month),extract(year from v_month),'closed',p_now,true) returning id into v_id;
      end if;
      if exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id
        join public.contracts c on c.id=i.contract_id left join public.commissions cm on cm.payment_id=p.id
        where c.lawyer_id=v_lawyer.id and p.voided_at is null and p.payment_date>=v_month and p.payment_date<v_end
        and cm.id is null) then raise exception 'Pagamento sem comissão: conferir dados antes de fechar'; end if;
      insert into public.monthly_closing_items(closing_id,payment_id,commission_id,payment_date,client_name,origin,
        amount_received,commission_percentage,commission_amount)
        select v_id,p.id,cm.id,p.payment_date,cl.full_name,c.origin,p.amount_paid,cm.commission_percentage,cm.commission_amount
        from public.payments p join public.commissions cm on cm.payment_id=p.id and cm.lawyer_id=v_lawyer.id
        join public.installments i on i.id=p.installment_id join public.contracts c on c.id=i.contract_id
        join public.clients cl on cl.id=c.client_id where p.voided_at is null and p.payment_date>=v_month and p.payment_date<v_end;
      update public.monthly_closings set office_amount_received=(select coalesce(sum(amount_received),0) from public.monthly_closing_items where closing_id=v_id),
        commission_amount=(select coalesce(sum(commission_amount),0) from public.monthly_closing_items where closing_id=v_id) where id=v_id;
      perform private.refresh_closing(v_id);
      insert into public.audit_logs(office_id,user_id,actor_kind,affected_lawyer_id,table_name,record_id,field_name,new_value,reason)
        values(v_lawyer.office_id,null,'system',v_lawyer.id,'monthly_closings',v_id,'automatic_closing',
        jsonb_build_object('period',v_month),'Fechamento automático mensal');
      insert into public.notifications(office_id,user_id,type,title,message,related_record_id)
        select v_lawyer.office_id,p.id,'automatic_closing','Relatório mensal disponível',
          'Fechamento de '||to_char(v_month,'MM/YYYY')||' concluído. Confira o relatório em Fechamentos.',v_id
        from public.profiles p where p.office_id=v_lawyer.office_id and p.active and (p.id=v_lawyer.id or p.role='manager');
      v_count:=v_count+1;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.run_automatic_closings(timestamptz) from public,anon,authenticated;

-- Reutiliza as rotinas transacionais atuais sem dar às advogadas as RPCs gerais do gestor.
do $clone$
declare d text;
begin
  d:=pg_get_functiondef('private.confirm_monthly_closing(uuid,smallint,smallint)'::regprocedure);
  if position('Este período é fechado automaticamente' in d)=0 then
    d:=replace(d,'v_start := make_date(p_year, p_month, 1);',
      'v_start := make_date(p_year, p_month, 1); if v_start >= ''2026-10-01''::date then raise exception ''Este período é fechado automaticamente''; end if;');
    execute d;
  end if;
  d:=pg_get_functiondef('private.revise_manager_payment(uuid,text,bigint,date)'::regprocedure);
  d:=replace(d,'private.revise_manager_payment(', 'private.revise_closed_payment(');
  d:=replace(d,$n$private.current_role() <> 'manager'$n$, $r$coalesce(private.current_role(),'') not in ('manager','lawyer')$r$);
  execute d;
  d:=pg_get_functiondef('private.manager_record_payment(uuid,date,bigint,text,text)'::regprocedure);
  d:=replace(d,'private.manager_record_payment(', 'private.record_closed_payment(');
  d:=replace(d,$n$private.current_role() <> 'manager'$n$, $r$coalesce(private.current_role(),'') not in ('manager','lawyer')$r$);
  execute d;
  -- Guards continuam bloqueando INSERT/UPDATE diretos e secretaria em mês fechado.
  foreach d in array array['private.guard_closed_month_payment()','private.guard_closed_month_void()','private.audit_payment_creation()'] loop
    execute replace(pg_get_functiondef(d::regprocedure),$n$private.current_role() = 'manager'$n$, $r$private.current_role() in ('manager','lawyer')$r$);
  end loop;
  d:=pg_get_functiondef('private.recalculate_contract_commissions(uuid,uuid,text)'::regprocedure);
  if position('app.closed_values_correction' in d)=0 then
    d:=replace(d,$n$private.current_role() is distinct from 'manager'$n$, $r$private.current_role() is distinct from 'manager' and not (private.current_role()='lawyer' and coalesce(current_setting('app.closed_values_correction',true),'')='on')$r$);
    execute d;
  end if;
end;
$clone$;
revoke all on function private.revise_closed_payment(uuid,text,bigint,date),private.record_closed_payment(uuid,date,bigint,text,text) from public,anon,authenticated;

create or replace function public.correct_closed_values(p_closing uuid,p_mode text,p_payment uuid,p_installment uuid,
  p_amount_cents bigint,p_date date,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.monthly_closings%rowtype; v_id uuid; v_start date;
begin
  if auth.uid() is null or coalesce(private.current_role(),'') not in ('manager','lawyer') or
    not private.office_owns_record('monthly_closings',p_closing) then raise exception 'Acesso não autorizado'; end if;
  select * into c from public.monthly_closings where id=p_closing;
  if not found or c.status='draft' or c.closed_at is null or (private.current_role()='lawyer' and c.lawyer_id<>auth.uid()) then
    raise exception 'Fechamento indisponível'; end if;
  perform private.lock_lawyer_finance(c.lawyer_id);
  v_start:=make_date(c.reference_year,c.reference_month,1);
  if p_mode is null or p_mode not in ('add','replace','void') or length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>1000 or
    (p_mode<>'void' and (p_date is null or p_date<v_start or p_date>=(v_start+interval '1 month')::date or
      p_date>(now() at time zone 'America/Sao_Paulo')::date or p_amount_cents is null or p_amount_cents<=0)) then
    raise exception 'Confira os valores, a data do mês e o motivo'; end if;
  perform set_config('app.closed_values_correction','on',true);
  if p_mode='add' then
    if not exists(select 1 from public.installments i join public.contracts ct on ct.id=i.contract_id
      where i.id=p_installment and ct.lawyer_id=c.lawyer_id and ct.office_id=private.current_office_id() and ct.deleted_at is null) then
      raise exception 'Parcela indisponível'; end if;
    v_id:=private.record_closed_payment(p_installment,p_date,p_amount_cents,'Correção após fechamento',p_reason);
  else
    if not exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id
      join public.contracts ct on ct.id=i.contract_id where p.id=p_payment and ct.lawyer_id=c.lawyer_id
        and ct.office_id=private.current_office_id() and p.voided_at is null and p.payment_date>=v_start and p.payment_date<(v_start+interval '1 month')::date) then
      raise exception 'Pagamento indisponível'; end if;
    v_id:=private.revise_closed_payment(p_payment,p_reason,case when p_mode='void' then null else p_amount_cents end,
      case when p_mode='void' then null else p_date end);
  end if;
  perform set_config('app.closed_values_correction','off',true);
  return v_id;
end;
$$;
revoke all on function public.correct_closed_values(uuid,text,uuid,uuid,bigint,date,text) from public,anon,authenticated;
grant execute on function public.correct_closed_values(uuid,text,uuid,uuid,bigint,date,text) to authenticated;

-- Todas as correções financeiras existentes também passam por este histórico/aviso.
create or replace function private.log_manager_change(p_lawyer uuid,p_table text,p_record uuid,
  p_field text,p_old jsonb,p_new jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_office uuid:=private.current_office_id(); v_message text; v_before text; v_after text; v_closing uuid;
begin
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(auth.uid(),p_lawyer,p_table,p_record,p_field,p_old,p_new,trim(p_reason)) returning id into v_id;
  v_before:=case when p_old ? 'amount_paid' then 'R$ '||replace(to_char((p_old->>'amount_paid')::numeric,'FM999999999999990.00'),'.',',')||
    ' em '||to_char((p_old->>'payment_date')::date,'DD/MM/YYYY') else coalesce(p_old::text,'nenhum') end;
  v_after:=case when p_new ? 'amount_paid' then 'R$ '||replace(to_char((p_new->>'amount_paid')::numeric,'FM999999999999990.00'),'.',',')||
    ' em '||to_char((p_new->>'payment_date')::date,'DD/MM/YYYY') when p_new->>'status'='voided' then 'recebimento estornado' else coalesce(p_new::text,'estornado') end;
  v_message:=(select full_name from public.profiles where id=auth.uid())||' corrigiu '||
    case when p_table='payments' then 'um recebimento' else p_table||'.'||p_field end||'. Anterior: '||v_before||
    '. Atual: '||v_after||'. Motivo: '||trim(p_reason);
  if p_table='payments' then
    select mc.id into v_closing from public.payments pay join public.monthly_closings mc on mc.lawyer_id=p_lawyer
      and mc.reference_year=extract(year from pay.payment_date) and mc.reference_month=extract(month from pay.payment_date)
      where pay.id=p_record and mc.status<>'draft';
  end if;
  insert into public.notifications(user_id,type,title,message,related_record_id)
    select p.id,case when v_closing is null then 'manager_correction' else 'closing_correction' end,
      'Valores corrigidos · conferir',v_message,coalesce(v_closing,p_record) from public.profiles p
    where p.office_id=v_office and p.active and p.id<>auth.uid() and
      ((private.current_role()='lawyer' and p.role='manager') or (private.current_role()='manager' and p.id=p_lawyer));
  return v_id;
end;
$$;

-- Reexecução segura: recupera outubro/2026 e meses vencidos, sem duplicar ou reabrir os confirmados.
select private.run_automatic_closings();
notify pgrst,'reload schema';
commit;
