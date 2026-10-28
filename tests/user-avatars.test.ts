import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { isUserAvatarPath, userInitials } from "../src/lib/users/avatar";

const admin = "11111111-1111-4111-8111-111111111111";
const lawyer = "22222222-2222-4222-8222-222222222222";
const otherAdmin = "33333333-3333-4333-8333-333333333333";
const otherOffice = "44444444-4444-4444-8444-444444444444";

test("caminhos de fotos são vinculados ao escritório e à pessoa; ausência de foto usa iniciais", () => {
  const path=`${otherOffice}/${lawyer}/${admin}.png`;
  assert.equal(isUserAvatarPath(path,otherOffice,lawyer),true);
  assert.equal(isUserAvatarPath(path,otherOffice,admin),false);
  assert.equal(isUserAvatarPath(path,admin,lawyer),false);
  assert.equal(isUserAvatarPath(path.replace('.png','.svg'),otherOffice,lawyer),false);
  assert.equal(isUserAvatarPath('https://example.com/'+path,otherOffice,lawyer),false);
  assert.equal(isUserAvatarPath(path+'/../foto.png',otherOffice,lawyer),false);
  assert.equal(userInitials('  Ágata  Silveira  '),'ÁS');
  assert.equal(userInitials(''),'U');
});

test("fotos privadas exigem admin, isolam escritórios, protegem arquivos em uso e preservam auditoria", async () => {
  const db=new PGlite();
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
    const first=`${office.id}/${lawyer}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
    const second=`${office.id}/${lawyer}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
    const own=`${office.id}/${admin}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`;
    const upload=(path:string,owner=admin)=>db.query("insert into storage.objects(bucket_id,name,owner_id) values('user-avatars',$1,$2)",[path,owner]);
    const save=(target:string,path:string|null,expected:string|null)=>db.query("select set_user_avatar($1,$2,$3)",[target,path,expected]);
    await asUser(admin);
    await upload(first); await save(lawyer,first,null);
    assert.equal((await db.query<{avatar_path:string}>("select avatar_path from profiles where id=$1",[lawyer])).rows[0].avatar_path,first);
    assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[first])).rows.length,0,"foto em uso não pode ser apagada diretamente");
    await assert.rejects(db.query("update profiles set avatar_path=null where id=$1",[lawyer]),/permission denied/);
    await upload(own); await save(admin,own,null);
    await asUser(lawyer);
    assert.equal((await db.query("select name from storage.objects where bucket_id='user-avatars'")).rows.length,1,"advogada só recebe a própria foto, como no perfil");
    await assert.rejects(save(lawyer,null,first),/não autorizado/);
    await assert.rejects(upload(second,lawyer),/row-level security/);
    await asUser(otherAdmin);
    assert.equal((await db.query("select name from storage.objects where bucket_id='user-avatars'")).rows.length,0);
    await assert.rejects(save(lawyer,null,first),/indisponível/);
    await assert.rejects(upload(second,otherAdmin),/row-level security/);
    await assert.rejects(upload(`${otherOffice}/${lawyer}/${admin}.png`,otherAdmin),/row-level security/);
    await asUser(admin);
    await upload(second);
    await assert.rejects(save(admin,second,own),/inválida/);
    await assert.rejects(save(lawyer,'https://example.com/foto.png',first),/inválida/);
    await assert.rejects(save(lawyer,second,null),/Recarregue/);
    await save(lawyer,second,first);
    assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[first])).rows.length,1,"só limpa a versão anterior após trocar a referência");
    const person=(await db.query<{role:string;active:boolean;is_office_admin:boolean}>("select role,active,is_office_admin from profiles where id=$1",[lawyer])).rows[0];
    assert.deepEqual(person,{role:'lawyer',active:true,is_office_admin:false},"foto não muda cargo nem permissões");
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec("grant update on storage.objects to authenticated");
    await db.exec(await readFile(new URL('20261028000300_user_avatars.sql',migrations),'utf8'));
    assert.equal((await db.query<{avatar_path:string}>("select avatar_path from profiles where id=$1",[lawyer])).rows[0].avatar_path,second,"reaplicar preserva a foto");
    const bucket=(await db.query<{public:boolean;file_size_limit:number}>("select public,file_size_limit from storage.buckets where id='user-avatars'")).rows[0];
    assert.equal(bucket.public,false); assert.equal(Number(bucket.file_size_limit),2097152);
    await asUser(admin);
    assert.equal((await db.query("update storage.objects set owner_id='forjado' where name=$1 returning name",[second])).rows.length,0,"arquivo não pode ser sobrescrito");
    await save(lawyer,null,second);
    assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[second])).rows.length,1);
    await db.exec("reset role; reset request.jwt.claim.sub");
    assert.equal((await db.query("select id from audit_logs where record_id=$1 and field_name='avatar_path'",[lawyer])).rows.length,3);
    await assert.rejects(db.exec("delete from audit_logs where field_name='avatar_path'"),/imutável/);
    await db.query("update profiles set active=false where id=$1",[admin]);
    await asUser(admin); await assert.rejects(save(lawyer,null,null),/não autorizado/);
    assert.equal((await db.query("select name from storage.objects where bucket_id='user-avatars'")).rows.length,0);
  } finally {await db.close();}
});
