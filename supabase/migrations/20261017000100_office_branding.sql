-- Identidade de cada escritório, independente da marca Repassum.
begin;

alter table public.offices add column if not exists logo_path text;
comment on column public.offices.logo_path is
  'Arquivo no bucket privado office-logos (<office_id>/<uuid>.<ext>) ou arte local provisionada pelo operador.';

-- Arte original fornecida para o piloto. A interface não associa nomes a logos.
update public.offices set logo_path = '/branding/offices/hp-consultoria-juridica.png'
where slug = 'principal' and name = 'HP Consultoria Jurídica' and logo_path is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('office-logos', 'office-logos', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists office_logos_read on storage.objects;
create policy office_logos_read on storage.objects for select to authenticated using (
  bucket_id = 'office-logos' and
  (storage.foldername(name))[1] = (select private.current_office_id())::text);

drop policy if exists office_logos_insert on storage.objects;
create policy office_logos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'office-logos' and (select private.is_office_admin()) and
  owner_id = (select auth.uid())::text and
  storage.foldername(name) = array[(select private.current_office_id())::text] and
  storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$');

-- Arquivos em uso não podem desaparecer por uma chamada direta ao Storage.
drop policy if exists office_logos_cleanup on storage.objects;
create policy office_logos_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'office-logos' and (select private.is_office_admin()) and
  (storage.foldername(name))[1] = (select private.current_office_id())::text and
  not exists (select 1 from public.offices o where o.id = (select private.current_office_id())
    and o.logo_path = storage.objects.name));

create or replace function private.set_office_logo(p_logo_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_office uuid := private.current_office_id();
  v_old text;
begin
  if auth.uid() is null or v_office is null or not private.is_office_admin() then
    raise exception 'Acesso não autorizado';
  end if;
  select logo_path into v_old from public.offices where id = v_office for update;
  if not found then raise exception 'Escritório indisponível'; end if;
  if p_logo_path is not null and (
    split_part(p_logo_path, '/', 1) <> v_office::text or
    p_logo_path !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' or
    not exists (select 1 from storage.objects where bucket_id = 'office-logos' and name = p_logo_path)
  ) then raise exception 'Logo inválido para este escritório'; end if;
  if v_old is not distinct from p_logo_path then return; end if;
  update public.offices set logo_path = p_logo_path where id = v_office;
  insert into public.audit_logs(user_id, office_id, table_name, record_id, field_name, old_value, new_value, reason)
  values (auth.uid(), v_office, 'offices', v_office, 'logo_path', to_jsonb(v_old), to_jsonb(p_logo_path),
    'Atualização da identidade visual do escritório');
end;
$$;
revoke all on function private.set_office_logo(text) from public, anon, authenticated;

create or replace function public.set_office_logo(p_logo_path text) returns void
language sql security invoker set search_path = '' as $$
  select private.set_office_logo(p_logo_path);
$$;
revoke all on function public.set_office_logo(text) from public, anon, authenticated;
grant execute on function public.set_office_logo(text), private.set_office_logo(text) to authenticated;

commit;
