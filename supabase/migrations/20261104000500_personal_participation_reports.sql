-- Relatórios financeiros próprios: terceiros identificados e cronograma pessoal.
-- Nenhuma parcela, pagamento ou composição de fechamento é alterada.
begin;
create or replace function public.financial_activity_report(
  p_kind text,p_from date,p_to date,p_lawyer uuid default null,
  p_client text default '',p_cpf text default '',p_origins text[] default '{}',
  p_service text default '',p_status text default 'all'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text:=private.current_role();v_office uuid:=private.current_office_id();b jsonb;v_contracts jsonb;v_thirds jsonb;v_today date;
begin
  if auth.uid() is null or v_office is null or coalesce(v_role,'') not in ('lawyer','manager') then
    raise exception 'Acesso não autorizado' using errcode='42501';end if;
  if v_role='lawyer' and p_lawyer is not null and p_lawyer<>auth.uid() then
    raise exception 'Selecione somente seus próprios dados' using errcode='42501';end if;
  -- A consulta base também valida todos os filtros e impõe escritório/titularidade.
  b:=public.filtered_activity_report_multi(p_kind,p_from,p_to,p_lawyer,p_client,p_cpf,p_origins,p_service,p_status);
  v_today:=(b->>'as_of')::date;
  select coalesce(jsonb_agg(jsonb_build_object('contract_id',c.id,'lawyer_name',lp.full_name,
    'commission_mode',t.commission_mode,'commission_percentage',t.commission_percentage,
    'commission_upfront_limit',t.commission_upfront_limit,'total_contract_value',c.total_contract_value,
    'commercial_percentage',t.commercial_percentage,'third_party_upfront_limit',t.third_party_upfront_limit,
    'commercial_recipient_name',t.commercial_recipient_name,
    'generated_amount',(select coalesce(sum(cm.commission_amount),0) from public.installments i join public.payments p on p.installment_id=i.id
      join public.commissions cm on cm.payment_id=p.id where i.contract_id=c.id and p.voided_at is null and p.payment_date<=v_today),
    'items',case when p_kind='installments' then (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'dueDate',i.due_date,'order',i.installment_number,'contractualCents',(i.contractual_amount*100)::bigint,
      'paidCents',paid.amount*100,'participation_received',paid.participation_received) order by i.due_date,i.installment_number,i.id),'[]')
      from public.installments i cross join lateral(select coalesce(sum(p.amount_paid),0) as amount,
        coalesce(bool_or(cm.payment_id is null or cm.commission_amount>0 or cc.amount>0),false) as participation_received
        from public.payments p left join public.commissions cm on cm.payment_id=p.id left join public.commercial_commissions cc on cc.payment_id=p.id
        where p.installment_id=i.id and p.voided_at is null and p.payment_date<=v_today) paid where i.contract_id=c.id) else '[]'::jsonb end
    ) order by c.id),'[]') into v_contracts
    from public.contracts c join public.profiles lp on lp.id=c.lawyer_id join public.contract_financial_terms t on t.contract_id=c.id
    where c.office_id=v_office and (v_role='manager' or c.lawyer_id=auth.uid())
      and c.id in(select distinct (r->>'contract_id')::uuid from jsonb_array_elements(b->'rows') r);
  select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'amount',case when cc.payment_id is not null then cc.amount
      when t.commercial_percentage=0 and coalesce(t.third_party_upfront_limit,0)=0 then 0 else null end,
      'recipient_name',coalesce(private.closing_payment_identity(p.id)->>'recipient_name',t.commercial_recipient_name)) order by p.id),'[]') into v_thirds
    from public.payments p join public.installments i on i.id=p.installment_id join public.contracts c on c.id=i.contract_id
    join public.contract_financial_terms t on t.contract_id=c.id left join public.commercial_commissions cc on cc.payment_id=p.id
    where c.office_id=v_office and (v_role='manager' or c.lawyer_id=auth.uid())
      and p.id in(select (r->>'payment_id')::uuid from jsonb_array_elements(b->'rows') r where r->>'payment_id' is not null);
  return b||jsonb_build_object('commissions',coalesce(b->'commissions','[]'::jsonb),'financial_contracts',v_contracts,'third_commissions',v_thirds,'personal_only',v_role='lawyer');
end $$;

create or replace function public.closed_month_participation_report(p_closing uuid,p_origins text[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b jsonb;v_rows jsonb;v_recipients jsonb;v_role text:=private.current_role();
begin
  if auth.uid() is null or coalesce(v_role,'') not in ('lawyer','manager') then raise exception 'Acesso não autorizado' using errcode='42501';end if;
  -- Validação de escritório/titularidade e reconciliação continuam na rotina base.
  b:=public.closed_month_origin_report(p_closing,p_origins);
  select coalesce(jsonb_agg(r order by r->>'payment_date',r->>'payment_id'),'[]') into v_rows from jsonb_array_elements(b->'rows') r
    join public.contract_financial_terms t on t.contract_id=(r->>'contract_id')::uuid
    where v_role='manager' or t.commission_mode<>'upfront' or (r->>'lawyer_amount')::numeric<>0 or (r->>'third_party_amount')::numeric<>0;
  select coalesce(jsonb_agg(r),'[]') into v_recipients from jsonb_array_elements(b->'recipients') r
    where exists(select 1 from jsonb_array_elements(v_rows) row where row->>'contract_id'=r->>'contract_id' and row->>'origin'=r->>'origin');
  return b||jsonb_build_object('rows',v_rows,'recipients',v_recipients,'personal_only',v_role='lawyer');
end $$;
revoke all on function public.financial_activity_report(text,date,date,uuid,text,text,text[],text,text),public.closed_month_participation_report(uuid,text[]) from public,anon,authenticated;
grant execute on function public.financial_activity_report(text,date,date,uuid,text,text,text[],text,text),public.closed_month_participation_report(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
