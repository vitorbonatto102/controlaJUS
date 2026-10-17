import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { officeInitials, officeLogoFormat } from "../src/lib/offices/branding";

test("logos aceitam apenas assinaturas de imagem conhecidas e usam iniciais como alternativa", () => {
  assert.equal(officeInitials("HP Consultoria Jurídica"), "HC");
  assert.equal(officeInitials("  Almeida  "), "A");
  assert.equal(officeInitials(""), "ES");
  assert.equal(officeLogoFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" />')), null);
  assert.equal(officeLogoFormat(new Uint8Array()), null);
  assert.equal(officeLogoFormat(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]))?.extension, "png");
  assert.equal(officeLogoFormat(new Uint8Array([255,216,255,224,0,0,0,0,0,0,0,0]))?.extension, "jpg");
  assert.equal(officeLogoFormat(new TextEncoder().encode("RIFF1234WEBPdata"))?.extension, "webp");
});

test("branding aplica todas as migrations, isola logos por escritório e exige admin para alterar", async () => {
  const db = new PGlite();
  const admin = "11111111-1111-4111-8111-111111111111";
  const lawyer = "22222222-2222-4222-8222-222222222222";
  const otherAdmin = "33333333-3333-4333-8333-333333333333";
  const otherOffice = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key, email text not null,
        raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text not null,
        public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (bucket_id text not null references storage.buckets(id),
        name text not null, owner_id text, primary key (bucket_id, name));
      create function storage.filename(path text) returns text language sql immutable as $$
        select reverse(split_part(reverse(path), '/', 1)) $$;
      create function storage.foldername(path text) returns text[] language sql immutable as $$
        select string_to_array(regexp_replace(path, '/[^/]+$', ''), '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated;
      grant select, insert, delete on storage.objects to authenticated;
    `);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(filename, migrations), "utf8"));
    const office = (await db.query<{ id: string; logo_path: string }>(
      "select id,logo_path from public.offices where slug='principal'")).rows[0];
    assert.equal(office.logo_path, "/branding/offices/hp-consultoria-juridica.png");
    await db.exec(`
      insert into public.offices(id,name,slug) values ('${otherOffice}','Outro escritório','outro');
      insert into auth.users(id,email) values ('${admin}','admin@example.com'),
        ('${lawyer}','lawyer@example.com'),('${otherAdmin}','other@example.com');
      update public.profiles set active=true,office_id='${office.id}',is_office_admin=true where id='${admin}';
      update public.profiles set active=true,office_id='${office.id}' where id='${lawyer}';
      update public.profiles set active=true,office_id='${otherOffice}',is_office_admin=true where id='${otherAdmin}';
    `);
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const logo = `${office.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
    const foreignLogo = `${otherOffice}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`;
    await asUser(admin);
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('office-logos',$1,$2)", [logo, admin]);
    await db.query("select public.set_office_logo($1)", [logo]);
    assert.equal((await db.query<{ logo_path: string }>("select logo_path from public.offices")).rows[0].logo_path, logo);
    assert.equal((await db.query("delete from storage.objects where name=$1 returning name", [logo])).rows.length, 0);
    await assert.rejects(() => db.query("update public.offices set name='Intrusão'"));
    await assert.rejects(() => db.query("select public.set_office_logo($1)", [foreignLogo]));
    await assert.rejects(() => db.query("select public.set_office_logo($1)", [`${office.id}/nao-existe.png`]));

    await asUser(lawyer);
    assert.equal((await db.query("select name from storage.objects where bucket_id='office-logos'")).rows.length, 1);
    await assert.rejects(() => db.query("select public.set_office_logo(null)"));
    await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name,owner_id) values ('office-logos',$1,$2)",
      [`${office.id}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg`, lawyer]));

    await asUser(otherAdmin);
    assert.equal((await db.query("select name from storage.objects where bucket_id='office-logos'")).rows.length, 0);
    await assert.rejects(() => db.query("select public.set_office_logo($1)", [logo]));
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('office-logos',$1,$2)", [foreignLogo, otherAdmin]);
    await db.query("select public.set_office_logo($1)", [foreignLogo]);

    await asUser(admin);
    // O mesmo escritório pode ter dois admins, sem trocar o cargo de advogada.
    await db.query("select public.manage_office_profile($1,'Advogada Teste','lawyer',true,true,'Adicionar outra administradora')", [lawyer]);
    await asUser(lawyer);
    await db.query("select public.set_office_logo(null)");
    assert.equal((await db.query("delete from storage.objects where name=$1 returning name", [logo])).rows.length, 1);
    await db.exec("reset role; reset request.jwt.claim.sub");
    const logs = await db.query("select id from public.audit_logs where table_name='offices' and field_name='logo_path'");
    assert.equal(logs.rows.length, 3);
    await assert.rejects(() => db.exec("update public.audit_logs set reason='apagado'"), /imutável/);
  } finally { await db.close(); }
});
