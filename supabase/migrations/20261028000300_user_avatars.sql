-- Fotos privadas dos usuários. Aplicar depois de 20261028000200. Reaplicável.
begin;
alter table public.profiles add column if not exists avatar_path text;
comment on column public.profiles.avatar_path is
  'Foto no bucket privado user-avatars: <office_id>/<user_id>/<uuid>.<ext>. Alterada somente pela administração do escritório.';
alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check check (avatar_path is null or (
  office_id is not null and split_part(avatar_path,'/',1)=office_id::text and split_part(avatar_path,'/',2)=id::text and
  avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
));

create or replace function private.guard_user_avatar() returns trigger
language plpgsql set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op='INSERT' then
    if new.avatar_path is not null then raise exception 'Defina a foto pelo gerenciamento de usuários'; end if;
  elsif new.avatar_path is distinct from old.avatar_path and
    current_setting('app.user_avatar_change',true) is distinct from 'on' then
    raise exception 'Altere a foto pelo fluxo administrativo auditado';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_user_avatar() from public,anon,authenticated;
drop trigger if exists profiles_avatar_guard on public.profiles;
create trigger profiles_avatar_guard before insert or update of avatar_path on public.profiles
  for each row execute function private.guard_user_avatar();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('user-avatars','user-avatars',false,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- As mesmas pessoas que já podem consultar o perfil podem consultar sua foto.
-- Admins também consultam seus uploads ainda não vinculados, para completar/limpar o envio.
drop policy if exists user_avatars_read on storage.objects;
create policy user_avatars_read on storage.objects for select to authenticated using (
  bucket_id='user-avatars' and (storage.foldername(name))[1]=(select private.current_office_id())::text and (
    (select private.is_office_admin()) or exists(select 1 from public.profiles p
      where p.office_id=(select private.current_office_id()) and p.avatar_path=storage.objects.name)
  )
);
drop policy if exists user_avatars_insert on storage.objects;
create policy user_avatars_insert on storage.objects for insert to authenticated with check (
  bucket_id='user-avatars' and (select private.is_office_admin()) and owner_id=(select auth.uid())::text and
  array_length(storage.foldername(name),1)=2 and
  (storage.foldername(name))[1]=(select private.current_office_id())::text and
  storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' and
  exists(select 1 from public.profiles p where p.id::text=(storage.foldername(name))[2]
    and p.office_id=(select private.current_office_id()))
);
drop policy if exists user_avatars_cleanup on storage.objects;
create policy user_avatars_cleanup on storage.objects for delete to authenticated using (
  bucket_id='user-avatars' and (select private.is_office_admin()) and
  (storage.foldername(name))[1]=(select private.current_office_id())::text and
  not exists(select 1 from public.profiles p where p.office_id=(select private.current_office_id())
    and p.avatar_path=storage.objects.name)
);
-- No UPDATE/upsert policy: each replacement creates a new immutable filename.

create or replace function public.set_user_avatar(p_user uuid,p_avatar_path text,p_expected_path text) returns void
language plpgsql security definer set search_path='' as $$
declare v_office uuid:=private.current_office_id(); v_profile public.profiles%rowtype;
  v_context text:=current_setting('app.user_avatar_change',true);
begin
  if auth.uid() is null or v_office is null or not private.is_office_admin() then
    raise exception 'Acesso não autorizado'; end if;
  select * into v_profile from public.profiles where id=p_user and office_id=v_office for update;
  if not found then raise exception 'Usuário indisponível neste escritório'; end if;
  if v_profile.avatar_path is distinct from p_expected_path then
    raise exception 'A foto foi alterada por outra pessoa. Recarregue a página antes de salvar'; end if;
  if p_avatar_path is not null and (
    split_part(p_avatar_path,'/',1)<>v_office::text or split_part(p_avatar_path,'/',2)<>p_user::text or
    p_avatar_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' or
    not exists(select 1 from storage.objects where bucket_id='user-avatars' and name=p_avatar_path and owner_id=auth.uid()::text)
  ) then raise exception 'Foto inválida para este usuário'; end if;
  if v_profile.avatar_path is not distinct from p_avatar_path then return; end if;
  perform set_config('app.user_avatar_change','on',true);
  update public.profiles set avatar_path=p_avatar_path where id=p_user;
  perform set_config('app.user_avatar_change',coalesce(v_context,''),true);
  insert into public.audit_logs(office_id,user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason)
    values(v_office,auth.uid(),case when v_profile.role='lawyer' then p_user else null end,'profiles',p_user,'avatar_path',
      to_jsonb(v_profile.avatar_path),to_jsonb(p_avatar_path),
      case when p_avatar_path is null then 'Foto do usuário removida pela administração' else 'Foto do usuário atualizada pela administração' end);
end;
$$;
revoke all on function public.set_user_avatar(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_user_avatar(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
