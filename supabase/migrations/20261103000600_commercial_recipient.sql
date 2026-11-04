-- Beneficiário comercial por contrato. Não altera percentuais ou valores históricos.
begin;
alter table public.contract_financial_terms add column if not exists commercial_recipient_name text
  check(commercial_recipient_name is null or (length(trim(commercial_recipient_name)) between 2 and 160 and commercial_recipient_name !~ '[[:cntrl:]]'));
alter table public.monthly_closing_items add column if not exists commercial_recipient_name text;

create or replace function private.save_commercial_recipient(p_contract uuid,p_name text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_lawyer uuid; v_old text; v_name text; v_commercial integer;
begin
  if auth.uid() is null or coalesce(private.current_role(),'') not in ('lawyer','manager') or
    not private.office_owns_record('contracts',p_contract) then raise exception 'Acesso não autorizado'; end if;
  select lawyer_id into v_lawyer from public.contracts where id=p_contract and deleted_at is null;
  if v_lawyer is null or (private.current_role()='lawyer' and v_lawyer<>auth.uid()) then raise exception 'Contrato indisponível'; end if;
  perform private.lock_lawyer_finance(v_lawyer);
  if private.current_role()='lawyer' and exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id where i.contract_id=p_contract) then
    raise exception 'Contrato movimentado: solicite a revisão ao gestor'; end if;
  select commercial_recipient_name,commercial_percentage into v_old,v_commercial from public.contract_financial_terms where contract_id=p_contract for update;
  v_name:=case when v_commercial>0 then nullif(trim(p_name),'') else null end;
  if (v_commercial>0 and (v_name is null or length(v_name) not between 2 and 160 or v_name ~ '[[:cntrl:]]')) or
    length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Informe o nome do beneficiário comercial (2 a 160 caracteres) e o motivo'; end if;
  if v_old is distinct from v_name then
    update public.contract_financial_terms set commercial_recipient_name=v_name where contract_id=p_contract;
    perform private.log_manager_change(v_lawyer,'contract_financial_terms',p_contract,'commercial_recipient_name',to_jsonb(v_old),to_jsonb(v_name),p_reason);
  end if;
end $$;

create or replace function public.save_contract_payout_terms_v2(p_contract uuid,p_commercial integer,p_day integer,p_start date,p_reason text,p_recipient_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.save_contract_payout_terms(p_contract,p_commercial,p_day,p_start,p_reason);
  perform private.save_commercial_recipient(p_contract,p_recipient_name,p_reason);
end $$;

create or replace function public.create_lawyer_contract_v5(p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_details->>'origin'='Tráfego HP' and (coalesce((p_details->>'commercial_percentage')::integer,5)<>5 or (p_details->>'commission_percentage')::integer<>5) then
    raise exception 'Novos contratos de tráfego usam 5%% advogada e 5%% comercial'; end if;
  perform set_config('app.traffic_contract_creation','on',true);
  perform private.create_lawyer_contract_v4(p_contract_id,p_parties,p_details-array['commercial_percentage','payout_day','first_payout_date','commercial_recipient_name'],p_schedule,p_file_path,p_file_name);
  perform private.save_contract_payout_terms(p_contract_id,coalesce((p_details->>'commercial_percentage')::integer,case when p_details->>'origin'='Tráfego HP' then 5 else 0 end),
    coalesce((p_details->>'payout_day')::integer,case when p_details->>'origin'='Tráfego HP' then 15 else 1 end),nullif(p_details->>'first_payout_date','')::date,'Condições de repasse definidas no cadastro');
  perform private.save_commercial_recipient(p_contract_id,p_details->>'commercial_recipient_name','Beneficiário definido no cadastro');
  perform set_config('app.traffic_contract_creation','off',true);
  return p_contract_id;
end $$;
create or replace function public.create_lawyer_contract_v6(p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text)
returns uuid language sql security invoker set search_path='' as $$
  select public.create_lawyer_contract_v5(p_contract_id,p_parties,p_details,p_schedule,p_file_path,p_file_name);
$$;

create or replace function public.edit_lawyer_contract_v3(p_contract_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_schedule jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_version timestamptz;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  perform private.lock_lawyer_finance(auth.uid());
  select updated_at into v_version from public.contracts where id=p_contract_id and lawyer_id=auth.uid()
    and office_id=private.current_office_id() and deleted_at is null for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_version then raise exception 'O contrato foi alterado. Recarregue a página'; end if;
  if p_schedule is not null and (p_changes->>'commercial_percentage')::integer=0 and exists(
    select 1 from public.contract_financial_terms where contract_id=p_contract_id and commercial_percentage>0) then
    perform private.save_contract_payout_terms(p_contract_id,0,(p_changes->>'payout_day')::integer,nullif(p_changes->>'first_payout_date','')::date,p_reason);
    select updated_at into v_version from public.contracts where id=p_contract_id;
  end if;
  perform private.edit_lawyer_contract_v2(p_contract_id,v_version,p_changes-array['commercial_percentage','payout_day','first_payout_date','commercial_recipient_name'],p_schedule,p_reason);
  if p_schedule is not null then
    perform private.save_contract_payout_terms(p_contract_id,(p_changes->>'commercial_percentage')::integer,(p_changes->>'payout_day')::integer,nullif(p_changes->>'first_payout_date','')::date,p_reason);
    perform private.save_commercial_recipient(p_contract_id,case when p_changes ? 'commercial_recipient_name' then p_changes->>'commercial_recipient_name'
      else (select commercial_recipient_name from public.contract_financial_terms where contract_id=p_contract_id) end,p_reason);
  elsif p_changes ?| array['commercial_percentage','payout_day','first_payout_date','commercial_recipient_name'] then raise exception 'Condições financeiras exigem revisão pelo gestor'; end if;
  return p_contract_id;
end $$;
create or replace function public.edit_lawyer_contract_v4(p_contract_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_schedule jsonb,p_reason text)
returns uuid language sql security invoker set search_path='' as $$
  select public.edit_lawyer_contract_v3(p_contract_id,p_expected_updated_at,p_changes,p_schedule,p_reason);
$$;

create or replace function private.payout_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select coalesce(cc.amount,0),coalesce(t.payout_day,case when c.origin='Tráfego HP' then 15 else 1 end),t.first_payout_date,t.commercial_recipient_name
    into new.commercial_amount,new.payout_day,new.first_payout_date,new.commercial_recipient_name from public.payments p
    join public.installments i on i.id=p.installment_id join public.contracts c on c.id=i.contract_id
    join public.contract_financial_terms t on t.contract_id=c.id left join public.commercial_commissions cc on cc.payment_id=p.id where p.id=new.payment_id;
  return new;
end $$;

-- Acrescenta identificação à agenda existente, mantendo cálculos, RLS e ajustes.
do $agenda$
declare d text;
begin
  d:=pg_get_functiondef('public.closing_payout_agenda(uuid)'::regprocedure);
  if position('snapshot.recipient_name' in d)=0 then
    if position('r.recipient,r.amount,' in d)=0 or position('max(s.first_payout_date) as starts' in d)=0 then
      raise exception 'Aplique primeiro a migration da agenda de repasses'; end if;
    d:=replace(d,'r.recipient,r.amount,','r.recipient,r.amount,case when r.recipient=''commercial'' then coalesce(snapshot.recipient_name,t.commercial_recipient_name) end as recipient_name,');
    d:=replace(d,'max(s.first_payout_date) as starts','max(s.first_payout_date) as starts,max(s.commercial_recipient_name) as recipient_name');
    execute d;
  end if;
end $agenda$;

-- A identificação do pagamento fica copiada na observação histórica, mesmo se o contrato mudar.
create or replace function private.capture_commercial_recipient() returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
  select value->>'recipient_name' into v_name from jsonb_array_elements(public.closing_payout_agenda(new.closing_id)->'items')
    where value->>'contract_id'=new.contract_id::text and value->>'recipient'='commercial';
  if v_name is null then raise exception 'Informe primeiro o beneficiário comercial na revisão do contrato'; end if;
  new.notes:=v_name||case when nullif(trim(new.notes),'') is null or trim(new.notes)=v_name then '' else E'\n'||trim(new.notes) end;
  return new;
end $$;
drop trigger if exists commercial_transfers_recipient on public.commercial_transfers;
create trigger commercial_transfers_recipient before insert on public.commercial_transfers for each row execute function private.capture_commercial_recipient();

revoke all on function private.save_commercial_recipient(uuid,text,text),private.capture_commercial_recipient() from public,anon,authenticated;
revoke all on function public.save_contract_payout_terms_v2(uuid,integer,integer,date,text,text),
  public.create_lawyer_contract_v6(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v4(uuid,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_contract_payout_terms_v2(uuid,integer,integer,date,text,text),
  public.create_lawyer_contract_v6(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v4(uuid,timestamptz,jsonb,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
