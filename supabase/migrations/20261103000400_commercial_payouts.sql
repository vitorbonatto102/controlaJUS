-- Reserva comercial e repasses por contrato. Não altera valores de contratos antigos.
begin;
alter table public.contract_financial_terms
  add column if not exists commercial_percentage smallint not null default 0 check(commercial_percentage in (0,5)),
  add column if not exists payout_day smallint check(payout_day between 1 and 31),
  add column if not exists first_payout_date date;
create table if not exists public.commercial_commissions (
  payment_id uuid primary key references public.payments(id),
  amount numeric(14,2) not null default 0 check(amount>=0)
);
create table if not exists public.commercial_closing_adjustments (
  id uuid primary key default gen_random_uuid(), closing_id uuid not null references public.monthly_closings(id),
  payment_id uuid not null references public.payments(id), amount numeric(14,2) not null check(amount<>0),
  reason text not null, recorded_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.monthly_closing_items add column if not exists commercial_amount numeric(14,2) not null default 0,
  add column if not exists payout_day smallint, add column if not exists first_payout_date date;
create table if not exists public.commission_transfer_allocations (
  id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.commission_transfers(id),
  contract_id uuid not null references public.contracts(id), amount numeric(14,2) not null check(amount>0),
  recorded_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.commercial_transfers (
  id uuid primary key default gen_random_uuid(), closing_id uuid not null references public.monthly_closings(id),
  contract_id uuid not null references public.contracts(id), amount numeric(14,2) not null check(amount>0),
  payment_date date not null, notes text, recorded_by uuid not null references public.profiles(id),
  reversed_at timestamptz, reversal_reason text, created_at timestamptz not null default now()
);
create table if not exists public.closing_payout_dates (
  closing_id uuid not null references public.monthly_closings(id), contract_id uuid not null references public.contracts(id),
  due_date date not null, primary key(closing_id,contract_id)
);
create index if not exists commercial_adjustments_closing on public.commercial_closing_adjustments(closing_id);
create index if not exists transfer_allocations_transfer on public.commission_transfer_allocations(transfer_id);
create index if not exists commercial_transfers_closing on public.commercial_transfers(closing_id);

alter table public.commercial_commissions enable row level security;
alter table public.commercial_closing_adjustments enable row level security;
alter table public.commission_transfer_allocations enable row level security;
alter table public.commercial_transfers enable row level security;
alter table public.closing_payout_dates enable row level security;
revoke all on public.commercial_commissions,public.commercial_closing_adjustments,public.commission_transfer_allocations,
  public.commercial_transfers,public.closing_payout_dates from anon,authenticated;
grant select on public.commercial_commissions,public.commercial_closing_adjustments,public.commission_transfer_allocations,
  public.commercial_transfers,public.closing_payout_dates to authenticated;
drop policy if exists commercial_read on public.commercial_commissions;
create policy commercial_read on public.commercial_commissions for select to authenticated using(
  (select private.current_role())='manager' and exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id
    join public.contracts c on c.id=i.contract_id where p.id=payment_id and c.office_id=(select private.current_office_id())));
drop policy if exists commercial_adjustments_read on public.commercial_closing_adjustments;
create policy commercial_adjustments_read on public.commercial_closing_adjustments for select to authenticated using(
  (select private.current_role())='manager' and exists(select 1 from public.monthly_closings mc where mc.id=closing_id));
drop policy if exists commercial_transfers_read on public.commercial_transfers;
create policy commercial_transfers_read on public.commercial_transfers for select to authenticated using(
  (select private.current_role())='manager' and exists(select 1 from public.monthly_closings mc where mc.id=closing_id));
drop policy if exists allocations_read on public.commission_transfer_allocations;
create policy allocations_read on public.commission_transfer_allocations for select to authenticated using(
  exists(select 1 from public.commission_transfers t where t.id=transfer_id));
drop policy if exists payout_dates_read on public.closing_payout_dates;
create policy payout_dates_read on public.closing_payout_dates for select to authenticated using(
  exists(select 1 from public.monthly_closings mc where mc.id=closing_id));

create or replace function private.validate_commercial_terms() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.commercial_percentage=5 and (new.commission_percentage<>5 or not exists(
    select 1 from public.contracts where id=new.contract_id and origin='Tráfego HP')) then
    raise exception 'Reserva comercial exige Tráfego HP com 5%% para cada beneficiário'; end if;
  return new;
end $$;
drop trigger if exists terms_validate_commercial on public.contract_financial_terms;
create trigger terms_validate_commercial before insert or update on public.contract_financial_terms
  for each row execute function private.validate_commercial_terms();
create or replace function private.guard_commercial_origin() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.origin<>'Tráfego HP' and exists(select 1 from public.contract_financial_terms where contract_id=new.id and commercial_percentage>0) then
    raise exception 'Revise a reserva comercial antes de alterar a origem deste contrato'; end if;
  return new;
end $$;
drop trigger if exists contracts_guard_commercial_origin on public.contracts;
create trigger contracts_guard_commercial_origin before update of origin on public.contracts for each row execute function private.guard_commercial_origin();
create or replace function private.guard_new_traffic_contract() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is not null and new.origin='Tráfego HP' and coalesce(current_setting('app.traffic_contract_creation',true),'')<>'on' then
    raise exception 'Atualize o cadastro para criar o contrato com a divisão comercial'; end if;
  return new;
end $$;
drop trigger if exists contracts_guard_new_traffic on public.contracts;
create trigger contracts_guard_new_traffic before insert on public.contracts for each row execute function private.guard_new_traffic_contract();

create or replace function private.commercial_adjustment(p_payment uuid,p_delta numeric,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_closing uuid; v_lawyer uuid;
begin
  if p_delta=0 then return; end if;
  select c.lawyer_id,mc.id into v_lawyer,v_closing from public.payments p join public.installments i on i.id=p.installment_id
    join public.contracts c on c.id=i.contract_id join public.monthly_closings mc on mc.lawyer_id=c.lawyer_id
      and mc.reference_year=extract(year from p.payment_date) and mc.reference_month=extract(month from p.payment_date)
    where p.id=p_payment and mc.status<>'draft';
  if v_closing is not null then
    insert into public.commercial_closing_adjustments(closing_id,payment_id,amount,reason,recorded_by)
      values(v_closing,p_payment,p_delta,p_reason,auth.uid());
  end if;
end $$;

create or replace function private.recalculate_contract_commissions(p_contract uuid,p_source uuid default null,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_lawyer uuid; v_mode text; v_percentage numeric; v_commercial numeric; v_target numeric;
  v_consumed numeric:=0; v_row record; v_amount numeric; v_business numeric; v_closed boolean;
  v_reason text:=coalesce(nullif(trim(p_reason),''),nullif(current_setting('app.commission_change_reason',true),''),'Redistribuição da comissão e reserva comercial');
begin
  select c.lawyer_id,t.commission_mode,t.commission_percentage,t.commercial_percentage,
    coalesce(t.commission_upfront_limit,round(c.total_contract_value*t.commission_percentage/100,2))
    into v_lawyer,v_mode,v_percentage,v_commercial,v_target from public.contracts c
    join public.contract_financial_terms t on t.contract_id=c.id where c.id=p_contract;
  if not found then raise exception 'Condições financeiras não encontradas'; end if;
  perform private.lock_lawyer_finance(v_lawyer);
  if v_mode='upfront' and v_target is null then raise exception 'Defina o limite da comissão'; end if;
  for v_row in select p.id,p.payment_date,p.amount_paid,cm.id as commission_id,cm.commission_amount,cm.commission_percentage,
      coalesce(cc.amount,0) as commercial_amount
    from public.installments i join public.payments p on p.installment_id=i.id join public.commissions cm on cm.payment_id=p.id
    left join public.commercial_commissions cc on cc.payment_id=p.id
    where i.contract_id=p_contract and p.voided_at is null order by p.payment_date,p.created_at,p.id for update of cm loop
    if v_mode='upfront' and v_commercial=5 then
      -- Arredondamento cumulativo preserva os dois limites e cada centavo recebido.
      v_amount:=round(least(v_consumed+v_row.amount_paid,2*v_target)/2,2)-round(least(v_consumed,2*v_target)/2,2);
      v_business:=least(v_consumed+v_row.amount_paid,2*v_target)-least(v_consumed,2*v_target)-v_amount;
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

create or replace function private.create_payment_commission() returns trigger language plpgsql security definer set search_path='' as $$
declare v_contract uuid; v_lawyer uuid; v_percentage numeric;
begin
  select c.id,c.lawyer_id,t.commission_percentage into v_contract,v_lawyer,v_percentage from public.installments i
    join public.contracts c on c.id=i.contract_id join public.contract_financial_terms t on t.contract_id=c.id where i.id=new.installment_id;
  if v_lawyer is null then raise exception 'Contrato sem condições financeiras'; end if;
  insert into public.commissions(payment_id,lawyer_id,commission_percentage,commission_amount) values(new.id,v_lawyer,v_percentage,0);
  insert into public.commercial_commissions(payment_id,amount) values(new.id,0);
  perform private.recalculate_contract_commissions(v_contract,new.id);
  return new;
end $$;
create or replace function private.commercial_void() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    perform private.commercial_adjustment(new.id,-coalesce((select amount from public.commercial_commissions where payment_id=new.id),0),new.void_reason);
  end if;
  return new;
end $$;
drop trigger if exists payments_commercial_void on public.payments;
create trigger payments_commercial_void after update of voided_at on public.payments for each row execute function private.commercial_void();

create or replace function private.payout_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select coalesce(cc.amount,0),coalesce(t.payout_day,case when c.origin='Tráfego HP' then 15 else 1 end),t.first_payout_date
    into new.commercial_amount,new.payout_day,new.first_payout_date from public.payments p
    join public.installments i on i.id=p.installment_id join public.contracts c on c.id=i.contract_id
    join public.contract_financial_terms t on t.contract_id=c.id left join public.commercial_commissions cc on cc.payment_id=p.id where p.id=new.payment_id;
  return new;
end $$;
drop trigger if exists closing_items_payout_snapshot on public.monthly_closing_items;
create trigger closing_items_payout_snapshot before insert on public.monthly_closing_items for each row execute function private.payout_snapshot();

create or replace function private.save_contract_payout_terms(p_contract uuid,p_commercial integer,p_day integer,p_start date,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_old public.contract_financial_terms%rowtype; v_lawyer uuid;
begin
  if auth.uid() is null or private.current_office_id() is null or coalesce(private.current_role(),'') not in ('lawyer','manager') or
    not private.office_owns_record('contracts',p_contract) then raise exception 'Acesso não autorizado'; end if;
  select lawyer_id into v_lawyer from public.contracts where id=p_contract and deleted_at is null;
  if v_lawyer is null or (private.current_role()='lawyer' and v_lawyer<>auth.uid()) then raise exception 'Contrato indisponível'; end if;
  perform private.lock_lawyer_finance(v_lawyer);
  if private.current_role()='lawyer' and exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id where i.contract_id=p_contract) then
    raise exception 'Contrato movimentado: solicite a revisão ao gestor'; end if;
  if p_commercial is null or p_commercial not in (0,5) or p_day is null or p_day not between 1 and 31 or
    (p_start is not null and (p_start<'1900-01-01'::date or p_start>'2200-12-31'::date)) or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Confira a reserva, o dia do repasse e o motivo'; end if;
  select * into v_old from public.contract_financial_terms where contract_id=p_contract for update;
  perform set_config('app.commission_change_reason',p_reason,true);
  update public.contract_financial_terms set commercial_percentage=p_commercial,payout_day=p_day,first_payout_date=p_start where contract_id=p_contract;
  perform private.recalculate_contract_commissions(p_contract,null,p_reason);
  if row(v_old.commercial_percentage,v_old.payout_day,v_old.first_payout_date) is distinct from row(p_commercial,p_day,p_start) then
    perform private.log_manager_change(v_lawyer,'contract_financial_terms',p_contract,'payout_terms',
      jsonb_build_object('commercial_percentage',v_old.commercial_percentage,'payout_day',v_old.payout_day,'first_payout_date',v_old.first_payout_date),
      jsonb_build_object('commercial_percentage',p_commercial,'payout_day',p_day,'first_payout_date',p_start),p_reason);
  end if;
end $$;
create or replace function public.save_contract_payout_terms(p_contract uuid,p_commercial integer,p_day integer,p_start date,p_reason text)
returns void language sql security invoker set search_path='' as $$ select private.save_contract_payout_terms(p_contract,p_commercial,p_day,p_start,p_reason); $$;

create or replace function public.create_lawyer_contract_v5(p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_details->>'origin'='Tráfego HP' and (coalesce((p_details->>'commercial_percentage')::integer,5)<>5 or (p_details->>'commission_percentage')::integer<>5) then
    raise exception 'Novos contratos de tráfego usam 5%% advogada e 5%% comercial'; end if;
  perform set_config('app.traffic_contract_creation','on',true);
  perform private.create_lawyer_contract_v4(p_contract_id,p_parties,p_details-array['commercial_percentage','payout_day','first_payout_date'],p_schedule,p_file_path,p_file_name);
  perform private.save_contract_payout_terms(p_contract_id,coalesce((p_details->>'commercial_percentage')::integer,case when p_details->>'origin'='Tráfego HP' then 5 else 0 end),
    coalesce((p_details->>'payout_day')::integer,case when p_details->>'origin'='Tráfego HP' then 15 else 1 end),nullif(p_details->>'first_payout_date','')::date,'Condições de repasse definidas no cadastro');
  perform set_config('app.traffic_contract_creation','off',true);
  return p_contract_id;
end $$;
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
  perform private.edit_lawyer_contract_v2(p_contract_id,v_version,p_changes-array['commercial_percentage','payout_day','first_payout_date'],p_schedule,p_reason);
  if p_schedule is not null then
    perform private.save_contract_payout_terms(p_contract_id,(p_changes->>'commercial_percentage')::integer,(p_changes->>'payout_day')::integer,nullif(p_changes->>'first_payout_date','')::date,p_reason);
  elsif p_changes ?| array['commercial_percentage','payout_day','first_payout_date'] then raise exception 'Condições financeiras exigem revisão pelo gestor'; end if;
  return p_contract_id;
end $$;

revoke all on function private.validate_commercial_terms(),private.guard_commercial_origin(),private.guard_new_traffic_contract(),private.commercial_adjustment(uuid,numeric,text),
  private.commercial_void(),private.payout_snapshot(),private.save_contract_payout_terms(uuid,integer,integer,date,text) from public,anon,authenticated;
revoke all on function public.save_contract_payout_terms(uuid,integer,integer,date,text),public.create_lawyer_contract_v5(uuid,jsonb,jsonb,jsonb,text,text),
  public.edit_lawyer_contract_v3(uuid,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.save_contract_payout_terms(uuid,integer,integer,date,text),public.save_contract_payout_terms(uuid,integer,integer,date,text),
  public.create_lawyer_contract_v5(uuid,jsonb,jsonb,jsonb,text,text),public.edit_lawyer_contract_v3(uuid,timestamptz,jsonb,jsonb,text) to authenticated;

create or replace function private.contract_payout_date(p_year integer,p_month integer,p_day integer,p_start date) returns date
language sql immutable set search_path='' as $$
  select greatest((make_date(p_year,p_month,1)+interval '1 month')::date+
    (least(p_day,extract(day from make_date(p_year,p_month,1)+interval '2 months - 1 day')::integer)-1),p_start);
$$;

-- A API anterior também registra somente pagamentos reais, não previsões futuras.
create or replace function private.register_commission_transfer(p_closing uuid,p_amount_cents bigint,p_date date,p_notes text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_closing public.monthly_closings%rowtype; v_id uuid;
begin
  if auth.uid() is null or private.current_role() is distinct from 'manager' or
    not private.office_owns_record('monthly_closings',p_closing) then raise exception 'Acesso não autorizado'; end if;
  if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>99999999999999 or p_date is null or
    p_date>(now() at time zone 'America/Sao_Paulo')::date or length(coalesce(p_notes,''))>1000 then
    raise exception 'Informe valor e data reais do repasse, sem data futura'; end if;
  select * into v_closing from public.monthly_closings where id=p_closing for update;
  if not found or v_closing.status='draft' then raise exception 'Fechamento indisponível'; end if;
  if p_amount_cents::numeric/100>v_closing.amount_pending_transfer then raise exception 'Repasse maior que o saldo. Confira o fechamento'; end if;
  insert into public.commission_transfers(closing_id,lawyer_id,amount,payment_date,notes,recorded_by)
    values(p_closing,v_closing.lawyer_id,p_amount_cents::numeric/100,p_date,nullif(trim(p_notes),''),auth.uid()) returning id into v_id;
  perform private.refresh_closing(p_closing);
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,new_value,reason)
    values(auth.uid(),v_closing.lawyer_id,'commission_transfers',v_id,'created',
      jsonb_build_object('amount',p_amount_cents::numeric/100,'payment_date',p_date),'Repasse registrado');
  return v_id;
end $$;

create or replace function public.closing_payout_agenda(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_closing public.monthly_closings%rowtype; v_items jsonb; v_unassigned jsonb;
begin
  if auth.uid() is null or private.current_office_id() is null or coalesce(private.current_role(),'') not in ('lawyer','manager') or
    not private.office_owns_record('monthly_closings',p_closing) then raise exception 'Acesso não autorizado'; end if;
  select * into v_closing from public.monthly_closings where id=p_closing;
  if not found or v_closing.status='draft' or v_closing.closed_at is null or
    (private.current_role()='lawyer' and v_closing.lawyer_id<>auth.uid()) then raise exception 'Fechamento indisponível'; end if;
  with flows as (
    select i.contract_id,s.commission_amount as lawyer,s.commercial_amount as commercial from public.monthly_closing_items s
      join public.payments p on p.id=s.payment_id join public.installments i on i.id=p.installment_id where s.closing_id=p_closing
    union all select i.contract_id,a.commission_delta,0 from public.closing_adjustments a
      join public.payments p on p.id=a.source_payment_id join public.installments i on i.id=p.installment_id where a.closing_id=p_closing
    union all select i.contract_id,0,a.amount from public.commercial_closing_adjustments a
      join public.payments p on p.id=a.payment_id join public.installments i on i.id=p.installment_id where a.closing_id=p_closing
  ), grouped as (
    select contract_id,sum(lawyer) as lawyer,sum(commercial) as commercial from flows group by contract_id
  ), amounts as (
    select g.contract_id,cl.full_name as client_name,c.origin,c.service_name,r.recipient,r.amount,
      coalesce(d.due_date,private.contract_payout_date(v_closing.reference_year,v_closing.reference_month,
        coalesce(snapshot.day,t.payout_day,case when c.origin='Tráfego HP' then 15 else 1 end),
        case when snapshot.day is not null then snapshot.starts else t.first_payout_date end)) as due_date,
      case when r.recipient='lawyer' then (select coalesce(sum(a.amount),0) from public.commission_transfer_allocations a
        join public.commission_transfers tr on tr.id=a.transfer_id where a.contract_id=g.contract_id and tr.closing_id=p_closing and tr.reversed_at is null)
      else (select coalesce(sum(tr.amount),0) from public.commercial_transfers tr where tr.contract_id=g.contract_id and tr.closing_id=p_closing and tr.reversed_at is null) end as paid
    from grouped g join public.contracts c on c.id=g.contract_id join public.clients cl on cl.id=c.client_id
    join public.contract_financial_terms t on t.contract_id=c.id
    left join public.closing_payout_dates d on d.closing_id=p_closing and d.contract_id=c.id
    left join lateral(select max(s.payout_day) as day,max(s.first_payout_date) as starts from public.monthly_closing_items s
      join public.payments p on p.id=s.payment_id join public.installments i on i.id=p.installment_id
      where s.closing_id=p_closing and i.contract_id=c.id) snapshot on true
    cross join lateral (values('lawyer',g.lawyer),('commercial',g.commercial)) r(recipient,amount)
    where (r.recipient='lawyer' or private.current_role()='manager')
      and (r.recipient='lawyer' or r.amount<>0 or exists(select 1 from public.commercial_transfers tr where tr.closing_id=p_closing and tr.contract_id=c.id))
  ) select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('balance',greatest(a.amount-a.paid,0),'overpaid',greatest(a.paid-a.amount,0))
    order by a.due_date,a.client_name,a.contract_id,a.recipient),'[]'::jsonb) into v_items from amounts a;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_unassigned from (
    select tr.id,tr.payment_date,tr.amount-coalesce((select sum(a.amount) from public.commission_transfer_allocations a where a.transfer_id=tr.id),0) as amount
    from public.commission_transfers tr where tr.closing_id=p_closing and tr.reversed_at is null
  ) t where t.amount>0;
  if (select coalesce(sum((value->>'amount')::numeric),0) from jsonb_array_elements(v_items) where value->>'recipient'='lawyer')
    <> v_closing.commission_amount+v_closing.adjustment_amount then
    raise exception 'A composição contém ajustes sem contrato identificado. Solicite conferência ao gestor'; end if;
  return jsonb_build_object('items',v_items,'unallocated_transfers',v_unassigned,'closing_id',p_closing)||
    case when private.current_role()='manager' then jsonb_build_object('commercial_transfers',coalesce((select jsonb_agg(to_jsonb(t) order by t.payment_date,t.id)
      from (select id,contract_id,amount,payment_date,notes,reversed_at,reversal_reason from public.commercial_transfers where closing_id=p_closing) t),'[]'::jsonb)) else '{}'::jsonb end;
end $$;

create or replace function public.register_scheduled_transfer(p_closing uuid,p_contract uuid,p_recipient text,p_amount_cents bigint,
  p_date date,p_notes text,p_existing_transfer uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_agenda jsonb; v_id uuid; v_lawyer uuid; v_available numeric; v_closed date;
begin
  if private.current_role() is distinct from 'manager' or not private.office_owns_record('monthly_closings',p_closing) then raise exception 'Acesso não autorizado'; end if;
  select lawyer_id,(make_date(reference_year,reference_month,1)+interval '1 month')::date into v_lawyer,v_closed from public.monthly_closings where id=p_closing;
  perform private.lock_lawyer_finance(v_lawyer);
  perform 1 from public.monthly_closings where id=p_closing for update;
  v_agenda:=public.closing_payout_agenda(p_closing);
  select value into v_item from jsonb_array_elements(v_agenda->'items') where value->>'contract_id'=p_contract::text and value->>'recipient'=p_recipient;
  if v_item is null or p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>99999999999999 or
    p_amount_cents::numeric/100>(v_item->>'balance')::numeric or length(coalesce(p_notes,''))>1000 then raise exception 'Confira o contrato, o valor e o saldo'; end if;
  if p_existing_transfer is not null then
    if p_recipient<>'lawyer' or length(trim(coalesce(p_notes,'')))<5 then raise exception 'Vínculo exige repasse da advogada e motivo'; end if;
    select (value->>'amount')::numeric into v_available from jsonb_array_elements(v_agenda->'unallocated_transfers') where value->>'id'=p_existing_transfer::text;
    if v_available is null or p_amount_cents::numeric/100>v_available then raise exception 'Repasse sem saldo para vincular'; end if;
    v_id:=p_existing_transfer;
  else
    if p_date is null or p_date<v_closed or p_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe a data real após a competência fechada, sem data futura'; end if;
    if p_recipient='lawyer' then
      if jsonb_array_length(v_agenda->'unallocated_transfers')>0 then raise exception 'Vincule primeiro os repasses já registrados'; end if;
      v_id:=private.register_commission_transfer(p_closing,p_amount_cents,p_date,p_notes);
    else
      if length(trim(coalesce(p_notes,'')))<2 then raise exception 'Identifique o beneficiário comercial na observação'; end if;
      insert into public.commercial_transfers(closing_id,contract_id,amount,payment_date,notes,recorded_by)
        values(p_closing,p_contract,p_amount_cents::numeric/100,p_date,nullif(trim(p_notes),''),auth.uid()) returning id into v_id;
    end if;
  end if;
  if p_recipient='lawyer' then
    insert into public.commission_transfer_allocations(transfer_id,contract_id,amount,recorded_by)
      values(v_id,p_contract,p_amount_cents::numeric/100,auth.uid());
  end if;
  if p_recipient='lawyer' then
    perform private.log_manager_change(v_lawyer,'commission_transfers',v_id,'scheduled_transfer',null,
      jsonb_build_object('contract_id',p_contract,'recipient',p_recipient,'amount',p_amount_cents::numeric/100,'existing_transfer',p_existing_transfer),
      coalesce(nullif(trim(p_notes),''),'Repasse registrado na agenda do contrato'));
  else
    insert into public.audit_logs(user_id,office_id,table_name,record_id,field_name,new_value,reason)
      values(auth.uid(),private.current_office_id(),'commercial_transfers',v_id,'created',jsonb_build_object('contract_id',p_contract,'amount',p_amount_cents::numeric/100,'payment_date',p_date),
        coalesce(nullif(trim(p_notes),''),'Repasse comercial registrado'));
  end if;
  return v_id;
end $$;

create or replace function public.revise_payout_date(p_closing uuid,p_contract uuid,p_date date,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_lawyer uuid;
begin
  if private.current_role() is distinct from 'manager' or not private.office_owns_record('monthly_closings',p_closing) then raise exception 'Acesso não autorizado'; end if;
  select lawyer_id into v_lawyer from public.monthly_closings where id=p_closing;
  perform private.lock_lawyer_finance(v_lawyer);
  select value into v_item from jsonb_array_elements(public.closing_payout_agenda(p_closing)->'items') where value->>'contract_id'=p_contract::text and value->>'recipient'='lawyer';
  if v_item is null or p_date is null or p_date<(select (make_date(reference_year,reference_month,1)+interval '1 month')::date from public.monthly_closings where id=p_closing)
    or p_date>'2200-12-31'::date or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Confira data, contrato e motivo'; end if;
  insert into public.closing_payout_dates(closing_id,contract_id,due_date) values(p_closing,p_contract,p_date)
    on conflict(closing_id,contract_id) do update set due_date=excluded.due_date;
  perform private.log_manager_change(v_lawyer,'monthly_closings',p_closing,'payout_due_date',v_item->'due_date',to_jsonb(p_date),p_reason);
end $$;

create or replace function public.reverse_commercial_transfer(p_transfer uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_row public.commercial_transfers%rowtype; v_lawyer uuid;
begin
  select * into v_row from public.commercial_transfers where id=p_transfer;
  if private.current_role() is distinct from 'manager' or v_row.id is null or not private.office_owns_record('monthly_closings',v_row.closing_id) then raise exception 'Acesso não autorizado'; end if;
  select lawyer_id into v_lawyer from public.monthly_closings where id=v_row.closing_id;
  perform private.lock_lawyer_finance(v_lawyer);
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Informe o motivo'; end if;
  update public.commercial_transfers set reversed_at=now(),reversal_reason=p_reason where id=p_transfer and reversed_at is null;
  if not found then raise exception 'Repasse já estornado'; end if;
  insert into public.audit_logs(user_id,office_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(auth.uid(),private.current_office_id(),'commercial_transfers',p_transfer,'reversed_at',null,to_jsonb(now()),p_reason);
end $$;

revoke all on function private.contract_payout_date(integer,integer,integer,date),public.closing_payout_agenda(uuid),
  public.register_scheduled_transfer(uuid,uuid,text,bigint,date,text,uuid),public.revise_payout_date(uuid,uuid,date,text),
  public.reverse_commercial_transfer(uuid,text) from public,anon,authenticated;
grant execute on function public.closing_payout_agenda(uuid),public.register_scheduled_transfer(uuid,uuid,text,bigint,date,text,uuid),
  public.revise_payout_date(uuid,uuid,date,text),public.reverse_commercial_transfer(uuid,text) to authenticated;

-- Prazos dos snapshots legados passam a ter uma referência estável sem editar o snapshot.
insert into public.closing_payout_dates(closing_id,contract_id,due_date)
  select distinct s.closing_id,i.contract_id,private.contract_payout_date(mc.reference_year,mc.reference_month,
    case when c.origin='Tráfego HP' then 15 else 1 end,null)
  from public.monthly_closing_items s join public.monthly_closings mc on mc.id=s.closing_id
  join public.payments p on p.id=s.payment_id join public.installments i on i.id=p.installment_id
  join public.contracts c on c.id=i.contract_id where s.payout_day is null
  on conflict(closing_id,contract_id) do nothing;

do $report$
declare d text;
begin
  d:=pg_get_functiondef('public.closed_month_report(uuid)'::regprocedure);
  if position('payout_agenda' in d)=0 then
    d:=replace(d,'return v_result;', 'return v_result||jsonb_build_object(''payout_agenda'',public.closing_payout_agenda(p_closing));');
    execute d;
  end if;
end $report$;
notify pgrst,'reload schema';
commit;
