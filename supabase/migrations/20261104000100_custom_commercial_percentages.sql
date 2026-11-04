-- Percentuais contratuais personalizáveis. Não recalcula contratos existentes.
begin;
alter table public.contract_financial_terms drop constraint if exists contract_financial_terms_commercial_percentage_check;
alter table public.contract_financial_terms drop constraint if exists terms_commercial_percentage_allowed;
alter table public.contract_financial_terms add constraint terms_commercial_percentage_allowed
  check(commercial_percentage in (0,5,10,15,20,25,30,35,40,45,50,55,60));
alter table public.contract_financial_terms drop constraint if exists terms_total_participation_limit;
alter table public.contract_financial_terms add constraint terms_total_participation_limit
  check(commission_percentage+commercial_percentage<=100);

create or replace function private.validate_commercial_terms() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.commercial_percentage>0 and not exists(select 1 from public.contracts where id=new.contract_id and origin='Tráfego HP') then
    raise exception 'A participação do comercial é permitida para Tráfego HP'; end if;
  if new.commission_percentage+new.commercial_percentage>100 then
    raise exception 'A soma das participações da advogada e do comercial não pode ultrapassar 100%%'; end if;
  return new;
end $$;

-- Mantém autorização, locks, auditoria e notificações das APIs existentes.
do $apis$
declare d text; old_guard text:=$guard$  if p_details->>'origin'='Tráfego HP' and (coalesce((p_details->>'commercial_percentage')::integer,5)<>5 or (p_details->>'commission_percentage')::integer<>5) then
    raise exception 'Novos contratos de tráfego usam 5%% advogada e 5%% comercial'; end if;$guard$;
begin
  d:=pg_get_functiondef('public.create_lawyer_contract_v5(uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure);
  if position(old_guard in d)>0 then execute replace(d,old_guard,'');
  elsif position('Novos contratos de tráfego usam' in d)>0 then raise exception 'Revise a versão da função de cadastro antes de aplicar esta atualização'; end if;
  d:=pg_get_functiondef('private.save_contract_payout_terms(uuid,integer,integer,date,text)'::regprocedure);
  if position('p_commercial not in (0,5)' in d)>0 then
    execute replace(d,'p_commercial not in (0,5)','p_commercial not in (0,5,10,15,20,25,30,35,40,45,50,55,60)'); end if;
  d:=pg_get_functiondef('public.edit_lawyer_contract_v3(uuid,timestamp with time zone,jsonb,jsonb,text)'::regprocedure);
  -- Retira a reserva anterior antes de editar ambos os percentuais, na mesma transação.
  -- A função original já impede edição financeira da advogada quando existe pagamento.
  if position('and (p_changes->>''commercial_percentage'')::integer=0 and exists(' in d)>0 then
    execute replace(d,'and (p_changes->>''commercial_percentage'')::integer=0 and exists(','and exists('); end if;
end $apis$;

create or replace function private.recalculate_contract_commissions(p_contract uuid,p_source uuid default null,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_lawyer uuid; v_mode text; v_percentage numeric; v_commercial numeric; v_target numeric; v_commercial_target numeric; v_combined numeric;
  v_consumed numeric:=0; v_row record; v_amount numeric; v_business numeric; v_closed boolean;
  v_reason text:=coalesce(nullif(trim(p_reason),''),nullif(current_setting('app.commission_change_reason',true),''),'Redistribuição da comissão e reserva comercial');
begin
  select c.lawyer_id,t.commission_mode,t.commission_percentage,t.commercial_percentage,
    coalesce(t.commission_upfront_limit,round(c.total_contract_value*t.commission_percentage/100,2)),
    round(coalesce(t.commission_upfront_limit*t.commercial_percentage/t.commission_percentage,c.total_contract_value*t.commercial_percentage/100),2)
    into v_lawyer,v_mode,v_percentage,v_commercial,v_target,v_commercial_target from public.contracts c
    join public.contract_financial_terms t on t.contract_id=c.id where c.id=p_contract;
  if not found then raise exception 'Condições financeiras não encontradas'; end if;
  perform private.lock_lawyer_finance(v_lawyer);
  if v_mode='upfront' and v_target is null then raise exception 'Defina o limite da comissão'; end if;
  v_combined:=v_target+v_commercial_target;
  for v_row in select p.id,p.payment_date,p.amount_paid,cm.id as commission_id,cm.commission_amount,cm.commission_percentage,
      coalesce(cc.amount,0) as commercial_amount
    from public.installments i join public.payments p on p.installment_id=i.id join public.commissions cm on cm.payment_id=p.id
    left join public.commercial_commissions cc on cc.payment_id=p.id
    where i.contract_id=p_contract and p.voided_at is null order by p.payment_date,p.created_at,p.id for update of cm loop
    if v_mode='upfront' and v_commercial>0 then
      -- Divisão cumulativa pelos limites monetários: preserva os limites individuais e centavos.
      if v_combined=0 then v_amount:=0; v_business:=0;
      else
        v_amount:=round(least(v_consumed+v_row.amount_paid,v_combined)*v_target/v_combined,2)
          -round(least(v_consumed,v_combined)*v_target/v_combined,2);
        v_business:=least(v_consumed+v_row.amount_paid,v_combined)-least(v_consumed,v_combined)-v_amount;
      end if;
    elsif v_mode='upfront' then
      v_amount:=least(v_row.amount_paid,greatest(v_target-v_consumed,0)); v_business:=0;
    else
      v_amount:=round(v_row.amount_paid*v_percentage/100,2);
      v_business:=least(round(v_row.amount_paid*v_commercial/100,2),greatest(v_row.amount_paid-v_amount,0));
    end if;
    v_consumed:=v_consumed+v_row.amount_paid;
    if v_amount is distinct from v_row.commission_amount or v_percentage is distinct from v_row.commission_percentage or
      v_business is distinct from v_row.commercial_amount then
      select exists(select 1 from public.monthly_closings mc where mc.lawyer_id=v_lawyer and
        mc.reference_year=extract(year from v_row.payment_date) and mc.reference_month=extract(month from v_row.payment_date) and mc.status<>'draft') into v_closed;
      if v_closed and private.current_role() is distinct from 'manager' and not
        (private.current_role()='lawyer' and coalesce(current_setting('app.closed_values_correction',true),'')='on') then
        raise exception 'O lançamento afeta um período já fechado. Use Corrigir valores'; end if;
      if v_row.id is distinct from p_source then
        perform private.add_closed_adjustment(v_lawyer,v_row.payment_date,v_row.id,0,v_amount-v_row.commission_amount,v_reason);
        insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
          values(auth.uid(),v_lawyer,'commissions',v_row.commission_id,'commission_amount',to_jsonb(v_row.commission_amount),to_jsonb(v_amount),v_reason);
      end if;
      perform private.commercial_adjustment(v_row.id,v_business-v_row.commercial_amount,v_reason);
      update public.commissions set commission_amount=v_amount,commission_percentage=v_percentage where id=v_row.commission_id;
      insert into public.commercial_commissions(payment_id,amount) values(v_row.id,v_business)
        on conflict(payment_id) do update set amount=excluded.amount;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
