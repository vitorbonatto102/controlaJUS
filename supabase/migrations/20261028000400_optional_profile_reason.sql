-- Motivo opcional somente na gestão cadastral de usuários.
-- Auditoria e proteções de escritório, acesso e histórico financeiro são preservadas.
-- Aplicar após 20261028000300. Reaplicável; não altera registros existentes.
begin;
create or replace function private.manage_office_profile(
  p_user uuid, p_name text, p_role text, p_active boolean,
  p_is_office_admin boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor_office uuid := private.current_office_id();
  v_old public.profiles%rowtype;
  v_lawyer uuid;
  v_reason text := coalesce(nullif(trim(p_reason),''),'Motivo não informado pelo administrador');
begin
  if auth.uid() is null or v_actor_office is null or not private.is_office_admin() then
    raise exception 'Acesso não autorizado';
  end if;
  if p_user is null or length(trim(coalesce(p_name,''))) not between 2 and 160 or
    p_role is null or p_role not in ('lawyer','secretary','manager') or p_active is null or
    p_is_office_admin is null or length(trim(coalesce(p_reason,''))) > 1000 then
    raise exception 'Dados inválidos';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_actor_office::text)::bigint);
  select * into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if v_old.office_id is not null and v_old.office_id <> v_actor_office then
    raise exception 'Usuário pertence a outro escritório';
  end if;
  if p_user = auth.uid() and (not p_active or not p_is_office_admin) then
    raise exception 'Não é possível remover o próprio acesso administrativo';
  end if;
  if v_old.office_id = v_actor_office and v_old.active and v_old.is_office_admin and
    (not p_active or not p_is_office_admin) and
    (select count(*) from public.profiles
      where office_id = v_actor_office and active and is_office_admin) <= 1 then
    raise exception 'O último administrador ativo do escritório não pode ser removido';
  end if;
  if v_old.role = 'lawyer' and p_role <> 'lawyer' and (exists
    (select 1 from public.contracts where lawyer_id = p_user) or exists
    (select 1 from public.monthly_closings where lawyer_id = p_user)) then
    raise exception 'Advogada com histórico financeiro deve manter o perfil lawyer';
  end if;
  update public.profiles set full_name = trim(p_name), role = p_role, active = p_active,
    is_office_admin = p_is_office_admin, office_id = v_actor_office where id = p_user;
  v_lawyer := case when p_role = 'lawyer' or v_old.role = 'lawyer' then p_user else null end;
  if v_old.full_name is distinct from trim(p_name) then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'full_name',
      to_jsonb(v_old.full_name),to_jsonb(trim(p_name)),v_reason);
  end if;
  if v_old.role is distinct from p_role then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'role',
      to_jsonb(v_old.role),to_jsonb(p_role),v_reason);
  end if;
  if v_old.active is distinct from p_active then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'active',
      to_jsonb(v_old.active),to_jsonb(p_active),v_reason);
  end if;
  if v_old.is_office_admin is distinct from p_is_office_admin then
    insert into public.audit_logs(user_id, affected_lawyer_id, office_id, table_name, record_id,
      field_name, old_value, new_value, reason)
    values(auth.uid(),v_lawyer,v_actor_office,'profiles',p_user,'is_office_admin',
      to_jsonb(v_old.is_office_admin),to_jsonb(p_is_office_admin),v_reason);
  end if;
end;
$$;
revoke all on function private.manage_office_profile(uuid,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function private.manage_office_profile(uuid,text,text,boolean,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
