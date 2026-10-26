-- Formas de retenção da participação da advogada. Aplicar após 20261022000600.
-- Reaplicável; contratos existentes permanecem proporcionais e não são recalculados.
begin;

alter table public.contract_financial_terms
  add column if not exists commission_mode text not null default 'proportional',
  add column if not exists commission_upfront_limit numeric(14,2);
alter table public.contract_financial_terms drop constraint if exists commission_retention_check;
alter table public.contract_financial_terms add constraint commission_retention_check check (
  (commission_mode='proportional' and commission_upfront_limit is null) or
  (commission_mode='upfront' and (commission_upfront_limit is null or
    commission_upfront_limit between 0.01 and 999999999999.99))
);
comment on column public.contract_financial_terms.commission_mode is
  'proportional: percentual sobre cada recebimento; upfront: primeiros recebimentos até quitar a participação contratada.';
comment on column public.contract_financial_terms.commission_upfront_limit is
  'Limite manual da comissão em reais para contrato sem valor definido. Nulo usa total_contract_value × commission_percentage.';
-- Estes campos permanecem na tabela financeira protegida por RLS, sem acesso da secretaria.

create or replace function private.lock_lawyer_finance(p_lawyer uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_lawyer is not null then
    perform pg_advisory_xact_lock(hashtextextended('lawyer-finance:'||p_lawyer::text,0));
  end if;
end;
$$;
revoke all on function private.lock_lawyer_finance(uuid) from public,anon,authenticated;

create or replace function private.lock_commission_record(p_table text,p_record uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_lawyer uuid;
begin
  if p_table in ('contracts','contract_financial_terms') then
    select lawyer_id into v_lawyer from public.contracts where id=p_record;
  elsif p_table='installments' then
    select c.lawyer_id into v_lawyer from public.installments i join public.contracts c on c.id=i.contract_id where i.id=p_record;
  elsif p_table='payments' then
    select c.lawyer_id into v_lawyer from public.payments p join public.installments i on i.id=p.installment_id
      join public.contracts c on c.id=i.contract_id where p.id=p_record;
  end if;
  perform private.lock_lawyer_finance(v_lawyer);
end;
$$;
revoke all on function private.lock_commission_record(text,uuid) from public,anon,authenticated;

create or replace function private.lock_payment_commissions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_commission_record('installments',new.installment_id);
  return new;
end;
$$;
revoke all on function private.lock_payment_commissions() from public,anon,authenticated;
drop trigger if exists a_payment_commission_lock on public.payments;
-- Antes dos guards de mês fechado e do lock de contrato: mesma ordem em todas as RPCs.
create trigger a_payment_commission_lock before insert or update of voided_at on public.payments
  for each row execute function private.lock_payment_commissions();

create or replace function private.validate_commission_retention() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_total numeric; v_lawyer uuid;
begin
  select total_contract_value,lawyer_id into v_total,v_lawyer from public.contracts where id=new.contract_id;
  perform private.lock_lawyer_finance(v_lawyer);
  if new.commission_mode='upfront' and new.commission_upfront_limit is null and v_total is null then
    raise exception 'Informe o limite total da comissão para contratos sem valor definido'; end if;
  return new;
end;
$$;
revoke all on function private.validate_commission_retention() from public,anon,authenticated;
drop trigger if exists terms_validate_commission_retention on public.contract_financial_terms;
create trigger terms_validate_commission_retention before insert or update on public.contract_financial_terms
  for each row execute function private.validate_commission_retention();

create or replace function private.guard_commission_base() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.total_contract_value is null and exists(select 1 from public.contract_financial_terms t
    where t.contract_id=new.id and t.commission_mode='upfront' and t.commission_upfront_limit is null) then
    raise exception 'Defina um limite de comissão antes de remover o valor do contrato'; end if;
  return new;
end;
$$;
revoke all on function private.guard_commission_base() from public,anon,authenticated;
drop trigger if exists contracts_guard_commission_base on public.contracts;
create trigger contracts_guard_commission_base before update of total_contract_value on public.contracts
  for each row execute function private.guard_commission_base();

-- A ordem é a data real do recebimento, seguida de created_at e UUID para desempate.
-- Recalcula somente comissões atuais; os snapshots dos fechamentos são imutáveis.
create or replace function private.recalculate_contract_commissions(p_contract uuid,p_source uuid default null,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_lawyer uuid; v_mode text; v_percentage numeric; v_target numeric; v_consumed numeric:=0;
  v_row record; v_amount numeric(14,2); v_closed boolean;
  v_reason text:=coalesce(nullif(trim(p_reason),''),nullif(current_setting('app.commission_change_reason',true),''),
    'Redistribuição da comissão conforme a forma de retenção do contrato');
begin
  select c.lawyer_id,t.commission_mode,t.commission_percentage,
    coalesce(t.commission_upfront_limit,round(c.total_contract_value*t.commission_percentage/100,2))
    into v_lawyer,v_mode,v_percentage,v_target from public.contracts c
    join public.contract_financial_terms t on t.contract_id=c.id where c.id=p_contract;
  if not found then raise exception 'Condições da comissão não encontradas'; end if;
  perform private.lock_lawyer_finance(v_lawyer);
  if v_mode='upfront' and v_target is null then raise exception 'Limite da comissão não definido'; end if;
  for v_row in select p.id,p.payment_date,p.amount_paid,cm.id as commission_id,
      cm.commission_amount,cm.commission_percentage
    from public.installments i join public.payments p on p.installment_id=i.id
    join public.commissions cm on cm.payment_id=p.id
    where i.contract_id=p_contract and p.voided_at is null
    order by p.payment_date,p.created_at,p.id for update of cm loop
    v_amount:=case when v_mode='upfront' then least(v_row.amount_paid,greatest(v_target-v_consumed,0))
      else round(v_row.amount_paid*v_percentage/100,2) end;
    v_consumed:=v_consumed+v_row.amount_paid;
    if v_amount is not distinct from v_row.commission_amount and v_percentage is not distinct from v_row.commission_percentage then continue; end if;
    if v_row.id is distinct from p_source then
      select exists(select 1 from public.monthly_closings mc where mc.lawyer_id=v_lawyer
        and mc.reference_year=extract(year from v_row.payment_date)
        and mc.reference_month=extract(month from v_row.payment_date) and mc.status<>'draft') into v_closed;
      if v_closed and private.current_role() is distinct from 'manager' then
        raise exception 'O lançamento afeta um período já fechado. Solicite a correção ao gestor'; end if;
      perform private.add_closed_adjustment(v_lawyer,v_row.payment_date,v_row.id,0,v_amount-v_row.commission_amount,v_reason);
      if v_amount is distinct from v_row.commission_amount then
        insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
          values(auth.uid(),v_lawyer,'commissions',v_row.commission_id,'commission_amount',
            to_jsonb(v_row.commission_amount),to_jsonb(v_amount),v_reason);
      end if;
      if v_percentage is distinct from v_row.commission_percentage then
        insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
          values(auth.uid(),v_lawyer,'commissions',v_row.commission_id,'commission_percentage',
            to_jsonb(v_row.commission_percentage),to_jsonb(v_percentage),v_reason);
      end if;
    end if;
    update public.commissions set commission_amount=v_amount,commission_percentage=v_percentage where id=v_row.commission_id;
  end loop;
end;
$$;
revoke all on function private.recalculate_contract_commissions(uuid,uuid,text) from public,anon,authenticated;

create or replace function private.create_payment_commission() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_contract uuid; v_lawyer uuid; v_percentage numeric; v_mode text;
begin
  select c.id,c.lawyer_id,t.commission_percentage,t.commission_mode into v_contract,v_lawyer,v_percentage,v_mode
    from public.installments i join public.contracts c on c.id=i.contract_id
    join public.contract_financial_terms t on t.contract_id=c.id where i.id=new.installment_id;
  if v_lawyer is null or v_percentage is null then raise exception 'Contrato sem percentual de participação'; end if;
  insert into public.commissions(payment_id,lawyer_id,commission_percentage,commission_amount)
    values(new.id,v_lawyer,v_percentage,case when v_mode='upfront' then 0 else round(new.amount_paid*v_percentage/100,2) end);
  if v_mode='upfront' then perform private.recalculate_contract_commissions(v_contract,new.id); end if;
  return new;
end;
$$;
revoke all on function private.create_payment_commission() from public,anon,authenticated;

create or replace function private.redistribute_voided_commission() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_contract uuid;
begin
  if old.voided_at is null and new.voided_at is not null then
    select i.contract_id into v_contract from public.installments i
      join public.contract_financial_terms t on t.contract_id=i.contract_id
      where i.id=new.installment_id and t.commission_mode='upfront';
    if v_contract is not null then
      perform private.recalculate_contract_commissions(v_contract,new.id,new.void_reason);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.redistribute_voided_commission() from public,anon,authenticated;
drop trigger if exists payments_redistribute_voided_commission on public.payments;
create trigger payments_redistribute_voided_commission after update of voided_at on public.payments
  for each row execute function private.redistribute_voided_commission();

create or replace function private.redistribute_changed_terms() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.commission_mode is distinct from old.commission_mode or
    new.commission_percentage is distinct from old.commission_percentage or
    new.commission_upfront_limit is distinct from old.commission_upfront_limit then
    perform private.recalculate_contract_commissions(new.contract_id);
  end if;
  return new;
end;
$$;
revoke all on function private.redistribute_changed_terms() from public,anon,authenticated;
drop trigger if exists terms_redistribute_commission on public.contract_financial_terms;
create trigger terms_redistribute_commission after update on public.contract_financial_terms
  for each row execute function private.redistribute_changed_terms();

create or replace function private.redistribute_changed_contract() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.total_contract_value is distinct from old.total_contract_value and exists(select 1 from public.contract_financial_terms t
    where t.contract_id=new.id and t.commission_mode='upfront' and t.commission_upfront_limit is null) then
    perform private.recalculate_contract_commissions(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.redistribute_changed_contract() from public,anon,authenticated;
drop trigger if exists contracts_redistribute_commission on public.contracts;
create trigger contracts_redistribute_commission after update of total_contract_value on public.contracts
  for each row execute function private.redistribute_changed_contract();

-- Atualiza as rotinas existentes sem remover seus guards de escritório, papel,
-- motivo ou mês fechado. Falha atomicamente se a definição esperada não existir.
do $patch_finance$
declare v_def text; v_start integer; v_end integer; v_signature text; v_needle text; v_injection text;
begin
  v_def:=pg_get_functiondef('private.correct_manager_field(text,uuid,text,text,text)'::regprocedure);
  if position('private.lock_commission_record(p_table,p_record)' in v_def)=0 then
    v_needle:='if p_record is null or v_new is null or length(v_new) = 0 then';
    if position(v_needle in v_def)=0 then raise exception 'Definição de correção cadastral incompatível'; end if;
    v_def:=replace(v_def,v_needle,'perform private.lock_commission_record(p_table,p_record);'||E'\n  '||
      'perform set_config(''app.commission_change_reason'',trim(p_reason),true);'||E'\n  '||v_needle);
    v_start:=position('    for v_payment in select p.id,p.payment_date,p.amount_paid,cm.id as commission_id,' in v_def);
    if v_start=0 then raise exception 'Recalculo anterior de comissão não encontrado'; end if;
    v_end:=position('    end loop;' in substring(v_def from v_start));
    if v_end=0 then raise exception 'Fim do recalculo anterior não encontrado'; end if;
    v_def:=substring(v_def from 1 for v_start-1)||
      '    -- Recalculo, auditoria e ajustes são executados pelo trigger das condições financeiras.'||
      substring(v_def from v_start+v_end-1+length('    end loop;'));
    execute v_def;
  end if;
  for v_signature,v_needle,v_injection in select * from (values
    ('private.revise_manager_payment(uuid,text,bigint,date)',
     'select * into v_old from public.payments where id = p_payment for update;',
     'perform private.lock_commission_record(''payments'',p_payment); perform set_config(''app.commission_change_reason'',trim(p_reason),true);'),
    ('private.revise_secretary_payment(uuid,text,bigint,date)',
     'select * into v_payment from public.payments where id = p_payment_id for update;',
     'perform private.lock_commission_record(''payments'',p_payment_id); perform set_config(''app.commission_change_reason'',trim(p_reason),true);'),
    ('private.manager_record_payment(uuid,date,bigint,text,text)',
     'select c.lawyer_id into v_lawyer from public.installments i',
     'perform private.lock_commission_record(''installments'',p_installment); perform set_config(''app.commission_change_reason'',trim(p_reason),true);'),
    ('private.confirm_monthly_closing(uuid,smallint,smallint)',
     'perform pg_advisory_xact_lock(hashtext(p_lawyer::text || v_start::text));',
     'perform private.lock_lawyer_finance(p_lawyer);'),
    ('private.edit_lawyer_contract(uuid,timestamp with time zone,jsonb,jsonb,text)',
     'select * into v_old from public.contracts where id = p_contract_id',
     'perform private.lock_lawyer_finance(auth.uid());')
  ) as changes(signature,needle,injection) loop
    v_def:=pg_get_functiondef(v_signature::regprocedure);
    if position(v_injection in v_def)=0 then
      if position(v_needle in v_def)=0 then raise exception 'Rotina incompatível: %',v_signature; end if;
      v_def:=replace(v_def,v_needle,v_injection||E'\n  '||v_needle);
      execute v_def;
    end if;
  end loop;
end;
$patch_finance$;

create or replace function private.create_lawyer_contract_v4(
  p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_mode text; v_limit numeric;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  v_mode:=p_details->>'commission_mode';
  if v_mode is null or v_mode not in ('proportional','upfront') then raise exception 'Selecione como será feito o pagamento das comissões'; end if;
  v_limit:=nullif(p_details->>'commission_upfront_limit','')::numeric;
  if (v_mode='proportional' and v_limit is not null) or
    (p_details->>'payment_method'<>'success_only' and v_limit is not null) then
    raise exception 'O limite deste contrato é calculado pelo valor total e percentual'; end if;
  if v_mode='upfront' and p_details->>'payment_method'='success_only' and (v_limit is null or v_limit<=0) then
    raise exception 'Informe o limite total da comissão da advogada para este contrato apenas no êxito'; end if;
  perform private.lock_lawyer_finance(auth.uid());
  perform private.create_lawyer_contract_v3(p_contract_id,p_parties,p_details- array['commission_mode','commission_upfront_limit'],p_schedule,p_file_path,p_file_name);
  update public.contract_financial_terms set commission_mode=v_mode,commission_upfront_limit=v_limit where contract_id=p_contract_id;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(auth.uid(),auth.uid(),'contract_financial_terms',p_contract_id,'commission_mode',null,to_jsonb(v_mode),'Forma de comissão definida no cadastro');
  if v_limit is not null then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),auth.uid(),'contract_financial_terms',p_contract_id,'commission_upfront_limit',null,to_jsonb(v_limit),'Limite da comissão definido no cadastro');
  end if;
  return p_contract_id;
end;
$$;
create or replace function public.create_lawyer_contract_v4(
  p_contract_id uuid,p_parties jsonb,p_details jsonb,p_schedule jsonb,p_file_path text,p_file_name text
) returns uuid language sql security invoker set search_path='' as $$
  select private.create_lawyer_contract_v4(p_contract_id,p_parties,p_details,p_schedule,p_file_path,p_file_name);
$$;
revoke all on function private.create_lawyer_contract_v4(uuid,jsonb,jsonb,jsonb,text,text),
  public.create_lawyer_contract_v4(uuid,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.create_lawyer_contract_v4(uuid,jsonb,jsonb,jsonb,text,text),
  public.create_lawyer_contract_v4(uuid,jsonb,jsonb,jsonb,text,text) to authenticated;

create or replace function private.edit_lawyer_contract_v2(
  p_contract_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_schedule jsonb,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_mode text; v_limit numeric; v_old_mode text; v_old_limit numeric; v_version timestamptz;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  perform private.lock_lawyer_finance(auth.uid());
  select updated_at into v_version from public.contracts where id=p_contract_id and lawyer_id=auth.uid()
    and office_id=private.current_office_id() and deleted_at is null for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_version then
    raise exception 'O contrato foi alterado. Recarregue a página antes de salvar'; end if;
  if p_schedule is null then
    if p_changes ?| array['commission_mode','commission_upfront_limit'] then raise exception 'Alteração financeira exige revisão do cronograma'; end if;
    return private.edit_lawyer_contract(p_contract_id,p_expected_updated_at,p_changes,p_schedule,p_reason);
  end if;
  if exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id where i.contract_id=p_contract_id) then
    raise exception 'Contrato com histórico de pagamentos. Solicite a correção financeira ao gestor'; end if;
  v_mode:=p_changes->>'commission_mode'; v_limit:=nullif(p_changes->>'commission_upfront_limit','')::numeric;
  if v_mode is null or v_mode not in ('proportional','upfront') then raise exception 'Selecione como será feito o pagamento das comissões'; end if;
  if (v_mode='proportional' and v_limit is not null) or (p_changes->>'payment_method'<>'success_only' and v_limit is not null) then
    raise exception 'O limite deste contrato é calculado pelo valor total e percentual'; end if;
  if v_mode='upfront' and p_changes->>'payment_method'='success_only' and (v_limit is null or v_limit<=0) then
    raise exception 'Informe o limite total da comissão para este contrato apenas no êxito'; end if;
  select commission_mode,commission_upfront_limit into v_old_mode,v_old_limit from public.contract_financial_terms where contract_id=p_contract_id;
  -- Sem pagamentos: permite trocar de forma ou de base sem invalidar estados intermediários.
  update public.contract_financial_terms set commission_mode='proportional',commission_upfront_limit=null where contract_id=p_contract_id;
  -- O trigger de versão das condições já carimbou o agregado nesta transação.
  -- A versão fornecida pelo usuário foi conferida acima, sob o mesmo lock.
  select updated_at into v_version from public.contracts where id=p_contract_id;
  perform private.edit_lawyer_contract(p_contract_id,v_version,p_changes-array['commission_mode','commission_upfront_limit'],p_schedule,p_reason);
  update public.contract_financial_terms set commission_mode=v_mode,commission_upfront_limit=v_limit where contract_id=p_contract_id;
  if v_old_mode is distinct from v_mode then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),auth.uid(),'contract_financial_terms',p_contract_id,'commission_mode',to_jsonb(v_old_mode),to_jsonb(v_mode),trim(p_reason));
  end if;
  if v_old_limit is distinct from v_limit then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),auth.uid(),'contract_financial_terms',p_contract_id,'commission_upfront_limit',to_jsonb(v_old_limit),to_jsonb(v_limit),trim(p_reason));
  end if;
  return p_contract_id;
end;
$$;
create or replace function public.edit_lawyer_contract_v2(
  p_contract_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_schedule jsonb,p_reason text
) returns uuid language sql security invoker set search_path='' as $$
  select private.edit_lawyer_contract_v2(p_contract_id,p_expected_updated_at,p_changes,p_schedule,p_reason);
$$;
revoke all on function private.edit_lawyer_contract_v2(uuid,timestamptz,jsonb,jsonb,text),
  public.edit_lawyer_contract_v2(uuid,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.edit_lawyer_contract_v2(uuid,timestamptz,jsonb,jsonb,text),
  public.edit_lawyer_contract_v2(uuid,timestamptz,jsonb,jsonb,text) to authenticated;

-- Correção conjunta de forma e limite: permite corrigir contratos já movimentados
-- sem estados intermediários inválidos. Reutiliza a redistribuição e os ajustes.
create or replace function private.correct_commission_retention(p_contract uuid,p_mode text,p_limit numeric,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_old public.contract_financial_terms%rowtype; v_lawyer uuid; v_total numeric;
begin
  if auth.uid() is null or private.current_role() is distinct from 'manager' or
    not private.office_owns_record('contracts',p_contract) then raise exception 'Acesso não autorizado'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 or
    p_mode is null or p_mode not in ('proportional','upfront') then raise exception 'Informe a forma e o motivo da correção'; end if;
  perform private.lock_commission_record('contracts',p_contract);
  select lawyer_id,total_contract_value into v_lawyer,v_total from public.contracts where id=p_contract and deleted_at is null;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_mode='proportional' and p_limit is not null then raise exception 'A retenção proporcional não utiliza limite'; end if;
  if p_mode='upfront' and ((v_total is null and (p_limit is null or p_limit<=0)) or
    (v_total is not null and p_limit is not null) or
    (p_limit is not null and (p_limit>999999999999.99 or round(p_limit,2)<>p_limit))) then
    raise exception 'Confira o limite da comissão; contratos com valor definido utilizam total × percentual'; end if;
  select * into v_old from public.contract_financial_terms where contract_id=p_contract for update;
  if not found then raise exception 'Condições de comissão não encontradas'; end if;
  if v_old.commission_mode is not distinct from p_mode and v_old.commission_upfront_limit is not distinct from p_limit then
    raise exception 'Os dados informados são iguais aos atuais'; end if;
  perform set_config('app.commission_change_reason',trim(p_reason),true);
  update public.contract_financial_terms set commission_mode=p_mode,commission_upfront_limit=p_limit where contract_id=p_contract;
  if v_old.commission_mode is distinct from p_mode then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),v_lawyer,'contract_financial_terms',p_contract,'commission_mode',
        to_jsonb(v_old.commission_mode),to_jsonb(p_mode),trim(p_reason));
  end if;
  if v_old.commission_upfront_limit is distinct from p_limit then
    insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
      values(auth.uid(),v_lawyer,'contract_financial_terms',p_contract,'commission_upfront_limit',
        to_jsonb(v_old.commission_upfront_limit),to_jsonb(p_limit),trim(p_reason));
  end if;
  insert into public.notifications(user_id,type,title,message,related_record_id)
    values(v_lawyer,'manager_correction','Pagamento das comissões corrigido',
      'O gestor corrigiu a forma ou o limite da comissão deste contrato. Forma atual: '||
      case when p_mode='upfront' then 'Retenção total no primeiro acerto.' else 'Retenção proporcional em cada parcela.' end||
      ' Motivo: '||trim(p_reason),p_contract);
end;
$$;
create or replace function public.correct_commission_retention(p_contract uuid,p_mode text,p_limit numeric,p_reason text)
returns void language sql security invoker set search_path='' as $$
  select private.correct_commission_retention(p_contract,p_mode,p_limit,p_reason);
$$;
revoke all on function private.correct_commission_retention(uuid,text,numeric,text),
  public.correct_commission_retention(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function private.correct_commission_retention(uuid,text,numeric,text),
  public.correct_commission_retention(uuid,text,numeric,text) to authenticated;

notify pgrst,'reload schema';
commit;
