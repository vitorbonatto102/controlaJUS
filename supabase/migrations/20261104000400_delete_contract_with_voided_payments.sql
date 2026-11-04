-- Exclusão lógica de contratos sem recebimentos válidos, preservando estornos.
-- Vínculos com fechamentos/repasses continuam exigindo conferência do gestor.
begin;
create or replace function private.delete_lawyer_contract(p_contract_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_contract public.contracts%rowtype;
begin
  if auth.uid() is null or private.current_role() is distinct from 'lawyer' then raise exception 'Acesso não autorizado'; end if;
  perform private.lock_lawyer_finance(auth.uid());
  select * into v_contract from public.contracts where id=p_contract_id and lawyer_id=auth.uid()
    and office_id=private.current_office_id() and deleted_at is null for update;
  if not found then raise exception 'Contrato indisponível'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_contract.updated_at then
    raise exception 'O contrato foi alterado. Recarregue a página antes de excluir'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Informe o motivo da exclusão'; end if;
  if exists(select 1 from public.payments p join public.installments i on i.id=p.installment_id
    where i.contract_id=p_contract_id and p.voided_at is null) then
    raise exception 'Contrato com pagamentos registrados não estornados não pode ser excluído. Solicite a correção ao gestor'; end if;
  if exists(select 1 from public.monthly_closing_items s join public.payments p on p.id=s.payment_id
      join public.installments i on i.id=p.installment_id where i.contract_id=p_contract_id)
    or exists(select 1 from public.closing_adjustments a join public.payments p on p.id=a.source_payment_id
      join public.installments i on i.id=p.installment_id where i.contract_id=p_contract_id)
    or exists(select 1 from public.commercial_closing_adjustments a join public.payments p on p.id=a.payment_id
      join public.installments i on i.id=p.installment_id where i.contract_id=p_contract_id)
    or exists(select 1 from public.commission_transfer_allocations a where a.contract_id=p_contract_id)
    or exists(select 1 from public.commercial_transfers t where t.contract_id=p_contract_id) then
    raise exception 'Contrato vinculado a fechamento ou repasse não pode ser excluído. Solicite a conferência ao gestor'; end if;
  update public.contracts set deleted_at=now(),deleted_by=auth.uid(),deletion_reason=trim(p_reason) where id=p_contract_id;
  insert into public.audit_logs(user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(auth.uid(),auth.uid(),'contracts',p_contract_id,'deleted_at','null'::jsonb,to_jsonb(now()),trim(p_reason));
  return p_contract_id;
end $$;
revoke all on function private.delete_lawyer_contract(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function private.delete_lawyer_contract(uuid,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;
