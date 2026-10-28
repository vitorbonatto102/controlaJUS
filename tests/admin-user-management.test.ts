import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("gestão de usuários aceita motivo opcional, mantém auditoria e proteções de acesso", async () => {
  const db=new PGlite();
  const admin="11111111-1111-4111-8111-111111111111";
  const lawyer="22222222-2222-4222-8222-222222222222";
  const otherAdmin="33333333-3333-4333-8333-333333333333";
  const otherOffice="44444444-4444-4444-8444-444444444444";
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
    const manage=(target:string,name:string,reason:string|null)=>db.query(
      "select manage_office_profile($1,$2,'lawyer',true,false,$3)",[target,name,reason]);
    await asUser(admin);
    await manage(lawyer,'Primeiro nome',null);
    await manage(lawyer,'Segundo nome','   ');
    await manage(lawyer,'Terceiro nome','ok');
    await assert.rejects(manage(lawyer,'Nome inválido','a'.repeat(1001)),/inválidos/);
    await assert.rejects(db.query("select manage_office_profile($1,'Admin','lawyer',false,false,null)",[admin]),/próprio acesso/);
    await asUser(lawyer);
    await assert.rejects(manage(lawyer,'Troca indevida',null),/não autorizado/);
    await asUser(otherAdmin);
    await assert.rejects(manage(lawyer,'Outro escritório',null),/outro escritório/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    const logs=(await db.query<{reason:string}>("select reason from audit_logs where table_name='profiles' and record_id=$1 and field_name='full_name' order by created_at,id",[lawyer])).rows;
    assert.equal(logs.length,3);
    assert.equal(logs.filter(row=>row.reason==='Motivo não informado pelo administrador').length,2);
    assert.equal(logs.filter(row=>row.reason==='ok').length,1);
    // Uma contratação real já vinculada continua impedindo a troca do cargo da advogada.
    const client=(await db.query<{id:string}>("insert into clients(office_id,full_name) values($1,'Cliente teste') returning id",[office.id])).rows[0].id;
    await db.query("insert into contracts(office_id,client_id,lawyer_id,origin,total_contract_value,contract_date) values($1,$2,$3,'Cliente próprio',1000,'2026-10-01')",[office.id,client,lawyer]);
    await asUser(admin);
    await assert.rejects(db.query("select manage_office_profile($1,'Terceiro nome','secretary',true,false,null)",[lawyer]),/histórico financeiro/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec(await readFile(new URL('20261028000400_optional_profile_reason.sql',migrations),'utf8'));
    assert.equal((await db.query("select id from audit_logs where table_name='profiles' and record_id=$1 and field_name='full_name'",[lawyer])).rows.length,3);
  } finally {await db.close();}
});
