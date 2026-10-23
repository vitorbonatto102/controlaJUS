-- Avisos operacionais para a advogada responsável. Aplicar após 20261022000500.
-- Reaplicável; não gera notificações retroativas nem altera valores financeiros.
begin;

create unique index if not exists notifications_secretary_event
  on public.notifications(user_id,type,related_record_id)
  where type in ('secretary_payment_recorded','secretary_payment_updated',
    'secretary_payment_voided','secretary_collection_note');

create or replace function private.notification_brl(p_amount numeric) returns text
language sql immutable set search_path='' as $$
  select 'R$ ' || translate(to_char(p_amount,'FM999,999,999,999,990.00'),',.','.,');
$$;
revoke all on function private.notification_brl(numeric) from public,anon,authenticated;

create or replace function private.notify_secretary_payment() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_payment public.payments%rowtype;
  v_office uuid; v_lawyer uuid; v_author text; v_client text; v_service text;
  v_installment text; v_context text; v_type text; v_title text; v_message text;
begin
  if new.table_name<>'payments' or new.field_name not in ('created','payment_state') or
    auth.uid() is distinct from new.user_id then return new; end if;
  select * into v_payment from public.payments where id=new.record_id;
  if not found then return new; end if;
  select c.office_id,c.lawyer_id,cl.full_name,c.service_name,
    case when i.kind='down_payment' then 'Entrada' else
      'Parcela ' || coalesce(i.regular_number,i.installment_number)::text end
    into v_office,v_lawyer,v_client,v_service,v_installment
    from public.installments i join public.contracts c on c.id=i.contract_id
    join public.clients cl on cl.id=c.client_id
    where i.id=v_payment.installment_id and c.deleted_at is null;
  if not found or new.office_id is distinct from v_office or
    new.affected_lawyer_id is distinct from v_lawyer then return new; end if;
  select coalesce(nullif(trim(full_name),''),'Secretaria') into v_author
    from public.profiles where id=new.user_id and role='secretary' and active and office_id=v_office;
  if not found then return new; end if;
  v_context:=format('Cliente: %s. Serviço: %s. %s.',v_client,coalesce(v_service,'Não informado'),v_installment);
  if new.field_name='created' then
    -- A edição insere um substituto e só depois preenche replaces_payment_id.
    -- O trigger adiado enxerga esse vínculo pronto, evitando um aviso de novo
    -- recebimento para o substituto além do aviso de alteração do original.
    if v_payment.replaces_payment_id is not null or v_payment.voided_at is not null then return new; end if;
    v_type:='secretary_payment_recorded'; v_title:='Pagamento registrado pela secretaria';
    v_message:=format('%s registrou %s em %s. %s',v_author,
      private.notification_brl((new.new_value->>'amount_paid')::numeric),
      to_char((new.new_value->>'payment_date')::date,'DD/MM/YYYY'),v_context);
  elsif new.new_value->>'status'='replaced' then
    v_type:='secretary_payment_updated'; v_title:='Pagamento alterado pela secretaria';
    v_message:=format('%s alterou o pagamento de %s (%s) para %s (%s). %s Motivo: %s',v_author,
      private.notification_brl((new.old_value->>'amount_paid')::numeric),
      to_char((new.old_value->>'payment_date')::date,'DD/MM/YYYY'),
      private.notification_brl((new.new_value->>'amount_paid')::numeric),
      to_char((new.new_value->>'payment_date')::date,'DD/MM/YYYY'),v_context,new.reason);
  elsif new.new_value->>'status'='voided' then
    v_type:='secretary_payment_voided'; v_title:='Pagamento excluído pela secretaria';
    v_message:=format('%s excluiu o registro de %s de %s. %s Motivo: %s. O histórico foi preservado.',v_author,
      private.notification_brl((new.old_value->>'amount_paid')::numeric),
      to_char((new.old_value->>'payment_date')::date,'DD/MM/YYYY'),v_context,new.reason);
  else return new;
  end if;
  insert into public.notifications(office_id,user_id,type,title,message,related_record_id)
    values(v_office,v_lawyer,v_type,v_title,v_message,new.record_id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.notify_secretary_payment() from public,anon,authenticated;

drop trigger if exists audit_secretary_payment_notification on public.audit_logs;
create constraint trigger audit_secretary_payment_notification
  after insert on public.audit_logs deferrable initially deferred for each row
  when (new.table_name='payments' and new.field_name in ('created','payment_state'))
  execute function private.notify_secretary_payment();

create or replace function private.notify_secretary_collection_note() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_office uuid; v_lawyer uuid; v_author text; v_client text; v_service text; v_kind text;
begin
  -- Notas gerais sem contrato continuam restritas ao fluxo operacional.
  if new.contract_id is null or auth.uid() is distinct from new.author_id then return new; end if;
  select c.office_id,c.lawyer_id,cl.full_name,c.service_name into v_office,v_lawyer,v_client,v_service
    from public.contracts c join public.clients cl on cl.id=new.client_id and cl.office_id=c.office_id
    where c.id=new.contract_id and c.deleted_at is null;
  if not found then return new; end if;
  select coalesce(nullif(trim(full_name),''),'Secretaria') into v_author
    from public.profiles where id=new.author_id and role='secretary' and active and office_id=v_office;
  if not found then return new; end if;
  v_kind:=case new.note_type when 'collection' then 'Cobrança registrada' when 'client_reply' then 'Retorno do cliente registrado'
    when 'renegotiation' then 'Renegociação registrada' else 'Anotação registrada' end;
  insert into public.notifications(office_id,user_id,type,title,message,related_record_id)
    values(v_office,v_lawyer,'secretary_collection_note',v_kind || ' pela secretaria',
      format('%s registrou: %s%s Cliente: %s. Serviço: %s.',v_author,left(new.content,350),
        case when length(new.content)>350 then '…' else '.' end,v_client,coalesce(v_service,'Não informado')),new.id)
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.notify_secretary_collection_note() from public,anon,authenticated;
drop trigger if exists collection_notes_secretary_notification on public.collection_notes;
create trigger collection_notes_secretary_notification after insert on public.collection_notes
  for each row execute function private.notify_secretary_collection_note();

-- Avisos antigos do gestor podem conter dados internos de participação.
-- Cada advogada lê os próprios avisos; a gestão mantém acesso no escritório.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  office_id=(select private.current_office_id()) and
  (user_id=(select auth.uid()) or (select private.current_role())='manager'));

notify pgrst,'reload schema';
commit;
