-- Retenção escolhida expressamente e um terceiro com limite monetário total.
-- Não modifica valores ou snapshots de contratos existentes.
begin;
alter table public.contract_financial_terms
  add column if not exists upfront_distribution text check(upfront_distribution in ('lawyer_only','shared')),
  add column if not exists third_party_upfront_limit numeric(14,2) check(third_party_upfront_limit>0);
comment on column public.contract_financial_terms.third_party_upfront_limit is 'Total a quitar ao único terceiro/comercial nas primeiras parcelas; não é valor por parcela.';
comment on table public.commercial_commissions is 'Destinação ao único terceiro/comercial por pagamento. Nome técnico legado; também atende terceiro com valor total em outras origens.';

create or replace function private.guard_explicit_distribution_total() returns trigger language plpgsql security definer set search_path='' as $$
declare v_total numeric;v_percentage numeric;v_limit numeric;
begin
  if tg_table_name='contracts' then
    select commission_percentage,coalesce(commission_upfront_limit,round(new.total_contract_value*commission_percentage/100,2)),third_party_upfront_limit into v_percentage,v_limit,v_total
      from public.contract_financial_terms where contract_id=new.id and commission_mode='upfront';
    if v_total is not null and new.total_contract_value is not null and v_limit+v_total>new.total_contract_value then raise exception 'Revise os limites das participações antes de reduzir o valor do contrato';end if;
  elsif new.commission_mode='upfront' and new.third_party_upfront_limit is not null then
    select total_contract_value into v_total from public.contracts where id=new.contract_id;
    if v_total is not null and coalesce(new.commission_upfront_limit,round(v_total*new.commission_percentage/100,2))+new.third_party_upfront_limit>v_total then raise exception 'As participações não podem ultrapassar o valor total do contrato';end if;
  end if;
  return new;
end $$;
drop trigger if exists terms_guard_explicit_distribution on public.contract_financial_terms;
create trigger terms_guard_explicit_distribution before insert or update on public.contract_financial_terms for each row execute function private.guard_explicit_distribution_total();
drop trigger if exists contracts_guard_explicit_distribution on public.contracts;
create trigger contracts_guard_explicit_distribution before update of total_contract_value on public.contracts for each row execute function private.guard_explicit_distribution_total();

do $bridge$
declare d text;
begin
  d:=pg_get_functiondef('private.save_contract_payout_terms(uuid,integer,integer,date,text)'::regprocedure);
  d:=replace(d,'or p_day is null or p_day not between 1 and 31','or (p_day is not null and p_day not between 1 and 31)');execute d;
  d:=pg_get_functiondef('public.create_lawyer_contract_v5(uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure);
  d:=replace(d,'coalesce((p_details->>''payout_day'')::integer,case when p_details->>''origin''=''Tráfego HP'' then 15 else 1 end)',
    'nullif(p_details->>''payout_day'','''')::integer');execute d;
  d:=pg_get_functiondef('private.recalculate_contract_commissions(uuid,uuid,text)'::regprocedure);
  if position('t.third_party_upfront_limit' in d)=0 then
    d:=replace(d,'round(coalesce(t.commission_upfront_limit*t.commercial_percentage/t.commission_percentage,c.total_contract_value*t.commercial_percentage/100),2)',
      'coalesce(case when t.commission_mode=''upfront'' then t.third_party_upfront_limit end,round(coalesce(t.commission_upfront_limit*t.commercial_percentage/t.commission_percentage,c.total_contract_value*t.commercial_percentage/100),2))');
    d:=replace(d,'v_mode=''upfront'' and v_commercial>0 then','v_mode=''upfront'' and (v_commercial>0 or v_commercial_target>0) then');execute d;
  end if;
  d:=pg_get_functiondef('private.save_commercial_recipient(uuid,text,text)'::regprocedure);
  d:=replace(d,'commercial_recipient_name,commercial_percentage into',
    'commercial_recipient_name,case when commercial_percentage>0 or (commission_mode=''upfront'' and coalesce(third_party_upfront_limit,0)>0) then 1 else 0 end into');execute d;
  d:=pg_get_functiondef('private.payout_snapshot()'::regprocedure);
  d:=replace(d,'coalesce(t.payout_day,case when c.origin=''Tráfego HP'' then 15 else 1 end)','t.payout_day');execute d;
  d:=pg_get_functiondef('public.closing_payout_agenda(uuid)'::regprocedure);
  d:=replace(d,E'\r\n',E'\n');
  d:=replace(d,replace($old$coalesce(d.due_date,private.contract_payout_date(v_closing.reference_year,v_closing.reference_month,
        coalesce(snapshot.day,t.payout_day,case when c.origin='Tráfego HP' then 15 else 1 end),
        case when snapshot.day is not null then snapshot.starts else t.first_payout_date end)) as due_date,$old$,E'\r\n',E'\n'),
    $new$coalesce(d.due_date,case when snapshot.day is not null then private.contract_payout_date(v_closing.reference_year,v_closing.reference_month,snapshot.day,snapshot.starts) end) as due_date,$new$);execute d;
end $bridge$;

create or replace function private.save_upfront_distribution(p_contract uuid,p_distribution text,p_limit numeric,p_name text,p_reason text,p_previous jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.contract_financial_terms%rowtype; c public.contracts%rowtype; v_old jsonb; v_new jsonb; v_distribution text; v_limit numeric; v_target numeric;
begin
  if auth.uid() is null or coalesce(private.current_role(),'') not in ('lawyer','manager') or not private.office_owns_record('contracts',p_contract) then raise exception 'Acesso não autorizado'; end if;
  select * into c from public.contracts where id=p_contract and deleted_at is null;
  if not found or (private.current_role()='lawyer' and c.lawyer_id<>auth.uid()) then raise exception 'Contrato indisponível'; end if;
  perform private.lock_lawyer_finance(c.lawyer_id);
  if private.current_role()='lawyer' and exists(select 1 from public.installments i join public.payments p on p.installment_id=i.id where i.contract_id=p_contract) then
    raise exception 'Contrato movimentado: solicite a revisão ao gestor'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Informe o motivo da revisão'; end if;
  select * into t from public.contract_financial_terms where contract_id=p_contract for update;
  v_old:=coalesce(p_previous,jsonb_build_object('distribution',t.upfront_distribution,'third_party_limit',t.third_party_upfront_limit,'recipient',t.commercial_recipient_name));
  if t.commission_mode='upfront' then
    if p_distribution is null or p_distribution not in ('lawyer_only','shared') then raise exception 'Escolha a destinação das primeiras parcelas'; end if;
    v_distribution:=p_distribution;
    if p_distribution='shared' then
      if p_limit is null or p_limit<=0 or p_limit>999999999999.99 or p_limit<>round(p_limit,2) or length(trim(coalesce(p_name,''))) not between 2 and 160 then
        raise exception 'Informe nome e valor total a quitar ao terceiro/comercial'; end if;
      v_limit:=p_limit;
      v_target:=coalesce(t.commission_upfront_limit,round(c.total_contract_value*t.commission_percentage/100,2));
      if v_target is null or (c.total_contract_value is not null and v_target+v_limit>c.total_contract_value) then raise exception 'As participações não podem ultrapassar o valor total do contrato'; end if;
    end if;
  elsif p_distribution is not null or p_limit is not null then raise exception 'Valores totais de terceiros são usados na retenção das primeiras parcelas'; end if;
  perform set_config('app.commission_change_reason',p_reason,true);
  update public.contract_financial_terms set upfront_distribution=v_distribution,third_party_upfront_limit=v_limit,
    commercial_percentage=case when v_distribution='lawyer_only' then 0 else commercial_percentage end where contract_id=p_contract;
  perform private.save_commercial_recipient(p_contract,p_name,p_reason);
  perform private.recalculate_contract_commissions(p_contract,null,p_reason);
  v_new:=jsonb_build_object('distribution',v_distribution,'third_party_limit',v_limit,'recipient',(select commercial_recipient_name from public.contract_financial_terms where contract_id=p_contract));
  if v_old is distinct from v_new then perform private.log_manager_change(c.lawyer_id,'contract_financial_terms',p_contract,'upfront_distribution',v_old,v_new,p_reason); end if;
end $$;

create or replace function public.create_lawyer_contract_v7(p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_details->>'commission_mode' is null or p_details->>'commission_mode' not in ('upfront','proportional') then raise exception 'Escolha como será retida a participação deste contrato'; end if;
  perform public.create_lawyer_contract_v6(p_contract_id,p_parties,p_details-array['upfront_distribution','third_party_upfront_limit','payout_day','first_payout_date'],p_schedule,p_file_path,p_file_name);
  perform private.save_upfront_distribution(p_contract_id,p_details->>'upfront_distribution',nullif(p_details->>'third_party_upfront_limit','')::numeric,p_details->>'commercial_recipient_name','Destinação informada no cadastro');
  return p_contract_id;
end $$;

create or replace function public.edit_lawyer_contract_v5(p_contract_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_schedule jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_version timestamptz; v_old jsonb;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  perform private.lock_lawyer_finance(auth.uid());
  select updated_at into v_version from public.contracts where id=p_contract_id and lawyer_id=auth.uid() and office_id=private.current_office_id() and deleted_at is null for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_version then raise exception 'O contrato foi alterado. Recarregue a página'; end if;
  if p_schedule is not null then
    if exists(select 1 from public.installments i join public.payments p on p.installment_id=i.id where i.contract_id=p_contract_id) then raise exception 'Contrato com histórico de pagamentos: solicite a revisão ao gestor'; end if;
    select jsonb_build_object('distribution',upfront_distribution,'third_party_limit',third_party_upfront_limit,'recipient',commercial_recipient_name) into v_old from public.contract_financial_terms where contract_id=p_contract_id;
    update public.contract_financial_terms set upfront_distribution=null,third_party_upfront_limit=null where contract_id=p_contract_id;
    select updated_at into v_version from public.contracts where id=p_contract_id;
  elsif p_changes ?| array['upfront_distribution','third_party_upfront_limit'] then raise exception 'Destinação exige revisão financeira'; end if;
  perform public.edit_lawyer_contract_v4(p_contract_id,v_version,p_changes-array['upfront_distribution','third_party_upfront_limit'],p_schedule,p_reason);
  if p_schedule is not null then perform private.save_upfront_distribution(p_contract_id,p_changes->>'upfront_distribution',nullif(p_changes->>'third_party_upfront_limit','')::numeric,p_changes->>'commercial_recipient_name',p_reason,v_old); end if;
  return p_contract_id;
end $$;

create or replace function public.save_contract_distribution(p_contract uuid,p_commercial integer,p_distribution text,p_limit numeric,p_name text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_day integer; v_start date;
begin
  if private.current_role() is distinct from 'manager' or not private.office_owns_record('contracts',p_contract) then raise exception 'Acesso não autorizado'; end if;
  select payout_day,first_payout_date into v_day,v_start from public.contract_financial_terms where contract_id=p_contract;
  perform private.save_contract_payout_terms(p_contract,p_commercial,v_day,v_start,p_reason);
  perform private.save_upfront_distribution(p_contract,p_distribution,p_limit,p_name,p_reason);
end $$;
revoke all on function private.save_upfront_distribution(uuid,text,numeric,text,text,jsonb),private.guard_explicit_distribution_total() from public,anon,authenticated;
revoke all on function public.create_lawyer_contract_v7(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v5(uuid,timestamptz,jsonb,jsonb,text),public.save_contract_distribution(uuid,integer,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.create_lawyer_contract_v7(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v5(uuid,timestamptz,jsonb,jsonb,text),public.save_contract_distribution(uuid,integer,text,numeric,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
