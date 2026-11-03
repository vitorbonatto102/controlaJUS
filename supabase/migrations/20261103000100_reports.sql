-- Relatórios de leitura. SECURITY INVOKER mantém todas as RLS existentes.
-- A permissão extra de admin não amplia o acesso financeiro de uma advogada/secretária.
begin;
create or replace function public.filtered_activity_report(
  p_kind text,p_from date,p_to date,p_lawyer uuid default null,
  p_client text default '',p_cpf text default '',p_origin text default '',
  p_service text default '',p_status text default 'all'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_role text:=private.current_role(); v_office uuid:=private.current_office_id();
  v_today date:=(current_timestamp at time zone 'America/Sao_Paulo')::date; v_result jsonb;
begin
  if auth.uid() is null or v_office is null or v_role is null or v_role not in ('lawyer','secretary','manager') then
    raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if v_role='lawyer' and p_lawyer is not null and p_lawyer<>auth.uid() then
    raise exception 'Selecione somente seus próprios dados' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('payments','installments','contracts') or p_from is null or p_to is null or
    p_from>p_to or p_from<'1900-01-01'::date or p_to>'2200-12-31'::date or
    p_status is null or p_status not in ('all','paid','open','overdue','partial') or
    (p_kind<>'installments' and p_status<>'all') or
    p_client is null or length(p_client)>160 or p_service is null or length(p_service)>180 or
    p_cpf is null or (p_cpf<>'' and p_cpf !~ '^[0-9]{11}$') or
    p_origin is null or p_origin not in ('','Cliente próprio','Propriedade Intelectual','Tráfego HP') then
    raise exception 'Confira o período e os filtros do relatório' using errcode='22023'; end if;
  with scoped as (
    select c.id,c.lawyer_id,lp.full_name as lawyer_name,c.contract_date,c.origin,c.service_name,
      c.total_contract_value,c.payment_method,
      coalesce(parties.people,jsonb_build_array(jsonb_build_object('name',cl.full_name,'cpf',cl.cpf))) as clients
    from public.contracts c join public.clients cl on cl.id=c.client_id
    join public.profiles lp on lp.id=c.lawyer_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('name',cpcl.full_name,'cpf',cpcl.cpf) order by cp.position) as people
      from public.contract_parties cp join public.clients cpcl on cpcl.id=cp.client_id where cp.contract_id=c.id
    ) parties on true
    where c.office_id=v_office and c.deleted_at is null and
      (v_role<>'lawyer' or c.lawyer_id=auth.uid()) and (p_lawyer is null or c.lawyer_id=p_lawyer)
      and (p_origin='' or c.origin=p_origin)
      and (p_service='' or position(lower(trim(p_service)) in lower(coalesce(c.service_name,'')))>0)
      and (p_client='' or position(lower(trim(p_client)) in lower(cl.full_name))>0 or exists(
        select 1 from public.contract_parties cp join public.clients pc on pc.id=cp.client_id
        where cp.contract_id=c.id and position(lower(trim(p_client)) in lower(pc.full_name))>0))
      and (p_cpf='' or cl.cpf=p_cpf or exists(select 1 from public.contract_parties cp
        join public.clients pc on pc.id=cp.client_id where cp.contract_id=c.id and pc.cpf=p_cpf))
  ), records as (
    select c.id as row_id,c.id as contract_id,c.lawyer_id,c.lawyer_name,c.clients,c.origin,c.service_name,
      c.contract_date,c.total_contract_value,c.payment_method,c.contract_date as event_date,
      null::uuid as payment_id,null::text as installment_label,null::date as due_date,
      null::numeric as contractual_amount,null::numeric as received_amount,null::numeric as balance,null::text as status
    from scoped c where p_kind='contracts' and c.contract_date between p_from and p_to
    union all
    select i.id,c.id,c.lawyer_id,c.lawyer_name,c.clients,c.origin,c.service_name,
      c.contract_date,c.total_contract_value,c.payment_method,i.due_date,null::uuid,
      case when i.kind='down_payment' then 'Entrada' else 'Parcela '||coalesce(i.regular_number,i.installment_number)::text end,
      i.due_date,i.contractual_amount,paid.amount,greatest(0,i.contractual_amount-paid.amount),
      case when paid.amount>=i.contractual_amount then 'paid' when paid.amount>0 then 'partial'
        when i.due_date<v_today then 'overdue' when i.due_date=v_today then 'today' else 'upcoming' end
    from scoped c join public.installments i on i.contract_id=c.id
    cross join lateral (select coalesce(sum(p.amount_paid),0) as amount from public.payments p
      where p.installment_id=i.id and p.voided_at is null and p.payment_date<=v_today) paid
    where p_kind='installments' and i.due_date between p_from and p_to and (
      p_status='all' or (p_status='paid' and paid.amount>=i.contractual_amount) or
      (p_status='open' and paid.amount<i.contractual_amount) or
      (p_status='overdue' and paid.amount<i.contractual_amount and i.due_date<v_today) or
      (p_status='partial' and paid.amount>0 and paid.amount<i.contractual_amount))
    union all
    select p.id,c.id,c.lawyer_id,c.lawyer_name,c.clients,c.origin,c.service_name,
      c.contract_date,c.total_contract_value,c.payment_method,p.payment_date,p.id,
      case when i.kind='down_payment' then 'Entrada' else 'Parcela '||coalesce(i.regular_number,i.installment_number)::text end,
      i.due_date,i.contractual_amount,p.amount_paid,null::numeric,null::text
    from scoped c join public.installments i on i.contract_id=c.id
    join public.payments p on p.installment_id=i.id
    where p_kind='payments' and p.payment_date between p_from and p_to and p.payment_date<=v_today and p.voided_at is null
  ) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r) order by r.event_date,r.row_id),'[]'::jsonb),'as_of',v_today,'issued_at',current_timestamp)
    into v_result from (select * from records order by event_date,row_id limit 5001) r;
  if jsonb_array_length(v_result->'rows')>5000 then
    raise exception 'O relatório ultrapassa 5.000 registros. Reduza o período ou refine os filtros' using errcode='54000'; end if;
  if v_role in ('lawyer','manager') and p_kind='payments' then
    v_result:=v_result||jsonb_build_object('commissions',coalesce((
      select jsonb_agg(jsonb_build_object('payment_id',co.payment_id,'amount',co.commission_amount))
      from public.commissions co join jsonb_to_recordset(v_result->'rows') as r(payment_id uuid) on r.payment_id=co.payment_id
    ),'[]'::jsonb));
  end if;
  return v_result;
end;
$$;
revoke all on function public.filtered_activity_report(text,date,date,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.filtered_activity_report(text,date,date,uuid,text,text,text,text,text) to authenticated;

-- A composição original nunca é reconstruída a partir de pagamentos alterados depois.
create or replace function public.closed_month_report(p_closing uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_role text:=private.current_role(); v_office uuid:=private.current_office_id();
  v_closing public.monthly_closings%rowtype; v_result jsonb;
begin
  if auth.uid() is null or v_office is null or v_role is null or v_role not in ('lawyer','manager') then
    raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  select mc.* into v_closing from public.monthly_closings mc join public.profiles lp on lp.id=mc.lawyer_id
    where mc.id=p_closing and lp.office_id=v_office and (v_role='manager' or mc.lawyer_id=auth.uid());
  if not found then raise exception 'Fechamento indisponível' using errcode='P0002'; end if;
  if v_closing.status='draft' or v_closing.closed_at is null then
    raise exception 'O relatório fica disponível após a confirmação do fechamento' using errcode='22023'; end if;
  select jsonb_build_object(
    'issued_at',current_timestamp,
    'closing',jsonb_build_object('id',v_closing.id,'lawyer_id',v_closing.lawyer_id,
      'reference_month',v_closing.reference_month,'reference_year',v_closing.reference_year,
      'office_amount_received',v_closing.office_amount_received,'commission_amount',v_closing.commission_amount,
      'office_adjustment_amount',v_closing.office_adjustment_amount,'adjustment_amount',v_closing.adjustment_amount,
      'amount_already_transferred',v_closing.amount_already_transferred,'amount_pending_transfer',v_closing.amount_pending_transfer,
      'amount_overpaid',v_closing.amount_overpaid,'status',v_closing.status,'closed_at',v_closing.closed_at,'paid_at',v_closing.paid_at),
    'lawyer_name',(select full_name from public.profiles where id=v_closing.lawyer_id),
    'office_name',(select name from public.offices where id=v_office),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.payment_date,i.id) from (
      select id,payment_date,client_name,origin,amount_received,commission_percentage,commission_amount
      from public.monthly_closing_items where closing_id=p_closing) i),'[]'::jsonb),
    'adjustments',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from (
      select id,office_delta,commission_delta,reason,created_at from public.closing_adjustments where closing_id=p_closing) a),'[]'::jsonb),
    'transfers',coalesce((select jsonb_agg(to_jsonb(t) order by t.payment_date,t.id) from (
      select id,amount,payment_date,notes,reversed_at,reversal_reason from public.commission_transfers where closing_id=p_closing) t),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.closed_month_report(uuid) from public,anon,authenticated;
grant execute on function public.closed_month_report(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
