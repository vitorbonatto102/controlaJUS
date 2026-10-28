import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("metas pertencem à advogada e ao escritório; secretaria, outra advogada e escritas forjadas são bloqueadas", async () => {
  const db = new PGlite();
  const lawyer = randomUUID(), colleague = randomUUID(), outsider = randomUUID(), secretary = randomUUID(), manager = randomUUID();
  const otherOffice = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text not null,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text not null references storage.buckets(id),name text not null,owner_id text,primary key(bucket_id,name));
      create function storage.filename(path text) returns text language sql immutable as $$ select reverse(split_part(reverse(path),'/',1)) $$;
      create function storage.foldername(path text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace(path,'/[^/]+$',''),'/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated;
      grant select,insert,delete on storage.objects to authenticated;`);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(filename, migrations), "utf8"));
    const office = (await db.query<{ id: string }>("select id from public.offices where slug='principal'")).rows[0].id;
    await db.query("insert into public.offices(id,name,slug) values($1,'Outro escritório','outro')", [otherOffice]);
    for (const [id, officeId, role] of [[lawyer, office, "lawyer"], [colleague, office, "lawyer"],
      [outsider, otherOffice, "lawyer"], [secretary, office, "secretary"], [manager, office, "manager"]]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.com`]);
      await db.query("update public.profiles set office_id=$2,role=$3,active=true where id=$1", [id, officeId, role]);
    }
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const save = (target: number) => db.query("select public.save_my_contract_goal('2026-10-01',$1::integer)", [target]);
    await asUser(lawyer); await save(10); await save(12);
    assert.equal((await db.query<{ target_contract_count: number }>("select target_contract_count from public.lawyer_monthly_goals")).rows[0].target_contract_count, 12);
    await assert.rejects(save(0), /quantidade/);
    await assert.rejects(db.exec("select public.save_my_contract_goal('2026-10-02',10)"), /quantidade/);
    await assert.rejects(db.query("insert into public.lawyer_monthly_goals(lawyer_id,office_id,reference_month,target_contract_count) values($1,$2,'2026-11-01',10)", [colleague, office]), /permission denied/);
    await assert.rejects(db.exec("update public.lawyer_monthly_goals set target_contract_count=100"), /permission denied/);
    await asUser(colleague);
    assert.equal((await db.query("select * from public.lawyer_monthly_goals")).rows.length, 0);
    await save(7);
    await asUser(outsider);
    assert.equal((await db.query("select * from public.lawyer_monthly_goals")).rows.length, 0);
    await asUser(secretary);
    assert.equal((await db.query("select * from public.lawyer_monthly_goals")).rows.length, 0);
    await assert.rejects(save(5), /não autorizado/);
    await asUser(manager);
    assert.equal((await db.query("select * from public.lawyer_monthly_goals")).rows.length, 2);
    await assert.rejects(save(5), /não autorizado/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.query("update public.profiles set active=false where id=$1", [lawyer]);
    await asUser(lawyer);
    assert.equal((await db.query("select * from public.lawyer_monthly_goals")).rows.length, 0);
    await assert.rejects(save(5), /não autorizado/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec(await readFile(new URL("20261028000100_lawyer_contract_goals.sql", migrations), "utf8"));
    assert.equal((await db.query("select * from public.lawyer_monthly_goals")).rows.length, 2);
  } finally { await db.close(); }
});
