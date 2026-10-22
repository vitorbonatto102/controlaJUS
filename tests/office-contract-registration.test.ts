import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("cadastro com todas as migrations reutiliza CPF no escritório e isola clientes entre escritórios", async () => {
  const db = new PGlite();
  const lawyer = "11111111-1111-4111-8111-111111111111";
  const otherLawyer = "22222222-2222-4222-8222-222222222222";
  const secretary = "33333333-3333-4333-8333-333333333333";
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
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    const office = (await db.query<{ id: string }>("select id from public.offices where slug='principal'")).rows[0].id;
    await db.query("insert into public.offices(id,name,slug) values ($1,'Outro escritório','outro')", [otherOffice]);
    await db.exec(`
      insert into auth.users(id,email) values ('${lawyer}','lawyer@example.com'),
        ('${otherLawyer}','other@example.com'),('${secretary}','secretary@example.com');
      update public.profiles set active=true,office_id='${office}' where id='${lawyer}';
      update public.profiles set active=true,office_id='${otherOffice}' where id='${otherLawyer}';
      update public.profiles set active=true,office_id='${office}',role='secretary' where id='${secretary}';
    `);
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const register = async (id: string, cpf = "52998224725", name = "Cliente Teste", amountCents = 100000) => {
      const schedule = JSON.stringify([{ installment_number: 1, kind: "regular", regular_number: 1,
        due_date: "2026-12-10", amount_cents: amountCents }]);
      return db.query(`select public.create_lawyer_contract_v2(
        $1::uuid, $2::text, $3::text, '2026-10-07'::date,
        100000::bigint, 'Cliente próprio', 40::smallint, 'cash',
        null::text, null::text, $4::jsonb, 'fixed_date', '2026-12-10'::date,
        null::text, 1, 100000::bigint, false, null::numeric, null::text, null::bigint, null::bigint
      )`, [id, name, cpf, schedule]);
    };

    await asUser(lawyer);
    const contractId = randomUUID();
    await register(contractId);
    await register(randomUUID());
    assert.equal((await db.query("select id from public.clients")).rows.length, 1);
    assert.equal((await db.query("select id from public.contracts")).rows.length, 2);
    assert.equal((await db.query("select id from public.installments")).rows.length, 2);
    await assert.rejects(register(randomUUID(), "52998224725", "Nome divergente"), /nome diferente/);
    await assert.rejects(register(randomUUID(), "11144477735", "Cliente sem contrato", 90000), /Valor ou ordem das parcelas inválidos/);
    assert.equal((await db.query("select id from public.clients where cpf='11144477735'")).rows.length, 0);

    await asUser(otherLawyer);
    assert.equal((await db.query("select id from public.contracts where id=$1", [contractId])).rows.length, 0);
    await register(randomUUID());
    assert.equal((await db.query("select id from public.clients")).rows.length, 1);
    assert.equal((await db.query("select id from public.contracts")).rows.length, 1);

    await asUser(secretary);
    await assert.rejects(register(randomUUID()), /Acesso não autorizado/);
    assert.equal((await db.query("select id from public.contracts")).rows.length, 2);

    await db.exec("reset role; reset request.jwt.claim.sub");
    assert.equal((await db.query("select id from public.clients where cpf='11144477735'")).rows.length, 0);
    const clients = (await db.query<{ office_id: string }>("select office_id from public.clients where cpf='52998224725'")).rows;
    assert.deepEqual(new Set(clients.map((client) => client.office_id)), new Set([office, otherOffice]));
    const repair = await readFile(new URL("20261022000100_contract_client_conflict.sql", migrations), "utf8");
    await db.exec(repair);
    await asUser(lawyer);
    await register(randomUUID());
    assert.equal((await db.query("select id from public.clients")).rows.length, 1);
    const successId = randomUUID();
    const success = (id: string, percentage: number | null = 30) => db.query(`select public.create_success_contract(
      $1::uuid, 'Cliente Teste', '52998224725', '2026-10-07'::date, 'Cliente próprio', 40::smallint,
      $2::numeric, null::text, null::text)`, [id, percentage]);
    await success(successId);
    const saved = (await db.query<{ total_contract_value: number | null; success_fee_percentage: string }>(
      "select total_contract_value,success_fee_percentage from public.contracts where id=$1", [successId])).rows[0];
    assert.equal(saved.total_contract_value, null);
    assert.equal(Number(saved.success_fee_percentage), 30);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [successId])).rows.length, 0);
    await assert.rejects(success(randomUUID(), null), /percentual cobrado/);
    await assert.rejects(success(randomUUID(), 101), /percentual cobrado/);
    // Mesmo o gestor não pode lançar parcelas fictícias nesse contrato por API.
    await db.exec("reset role; reset request.jwt.claim.sub");
    await assert.rejects(db.query(`insert into public.installments(contract_id,installment_number,regular_number,due_date,contractual_amount)
      values ($1,1,1,'2026-12-10',100)`, [successId]), /não possui valor/);
    await assert.rejects(db.query("update public.contracts set total_contract_value=100 where id=$1", [successId]), /contracts_success_terms_check/);
    await asUser(otherLawyer);
    assert.equal((await db.query("select id from public.contracts where id=$1", [successId])).rows.length, 0);
    await asUser(secretary);
    assert.equal((await db.query("select id from public.contracts where id=$1", [successId])).rows.length, 1);
    assert.equal((await db.query("select contract_id from public.contract_financial_terms where contract_id=$1", [successId])).rows.length, 0);
    await assert.rejects(success(randomUUID()), /Acesso não autorizado/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    // A nova migration também pode ser reaplicada pelo SQL Editor.
    await db.exec(await readFile(new URL("20261022000200_success_only_contracts.sql", migrations), "utf8"));
  } finally { await db.close(); }
});
