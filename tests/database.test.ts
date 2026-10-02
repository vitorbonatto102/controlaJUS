import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const lawyerA = "11111111-1111-4111-8111-111111111111";
const lawyerB = "22222222-2222-4222-8222-222222222222";
const secretary = "33333333-3333-4333-8333-333333333333";
const contractA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const contractB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileA = `contracts/${lawyerA}/${contractA}/aaaaaaaa-aaaa-4aaa-8aaa-000000000001.pdf`;
const fileB = `contracts/${lawyerB}/${contractB}/bbbbbbbb-bbbb-4bbb-8bbb-000000000002.pdf`;

async function migrate(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key, email text not null,
      raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table storage.buckets (id text primary key, name text not null,
      public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text not null references storage.buckets(id),
      name text not null, owner_id text, primary key (bucket_id, name));
    create function storage.filename(path text) returns text language sql immutable as $$
      select reverse(split_part(reverse(path), '/', 1))
    $$;
    create function storage.foldername(path text) returns text[] language sql immutable as $$
      select string_to_array(regexp_replace(path, '/[^/]+$', ''), '/')
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
  `);
  for (const name of ["20261001000100_schema.sql", "20261001000200_rls.sql",
    "20261001000300_storage.sql", "20261001000400_lawyer_contracts.sql",
    "20261001000500_secretary_operations.sql",
    "20261002000100_closings_management.sql",
    "20261002000200_payment_integrity.sql"]) {
    const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    await db.exec(sql);
  }
}

async function asUser(db: PGlite, id: string) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}

async function asOwner(db: PGlite) {
  await db.exec("reset role");
  await db.exec("reset request.jwt.claim.sub");
}

async function createContract(db: PGlite, userId: string, contractId: string,
  filePath: string, cpf: string) {
  await asUser(db, userId);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('contract-pdfs',$1,$2)",
    [filePath, userId]);
  const result = await db.query<{ create_lawyer_contract: string }>(`
    select public.create_lawyer_contract(
      $1::uuid, 'Cliente Teste', $2::text, '2026-10-01'::date,
      100000::bigint, 'Cliente próprio', 40::smallint, 'cash',
      $3::text, 'contrato.pdf',
      '[{"installment_number":1,"kind":"regular","regular_number":1,
        "due_date":"2026-10-10","amount_cents":100000}]'::jsonb
    )`, [contractId, cpf, filePath]);
  assert.equal(result.rows[0].create_lawyer_contract, contractId);
  await asOwner(db);
}

test("migrations e isolamento RLS de contratos, pagamentos, comissões e PDFs", async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    await db.exec(`
      insert into auth.users(id,email) values
        ('${lawyerA}','a@example.com'),('${lawyerB}','b@example.com'),
        ('${secretary}','s@example.com');
      update public.profiles set active = true where id in ('${lawyerA}','${lawyerB}');
      update public.profiles set active = true, role = 'secretary' where id = '${secretary}';
    `);
    await createContract(db, lawyerA, contractA, fileA, "52998224725");
    await createContract(db, lawyerB, contractB, fileB, "11144477735");

    await asUser(db, lawyerA);
    const contracts = await db.query<{ id: string }>("select id from public.contracts");
    assert.deepEqual(contracts.rows.map((row) => row.id), [contractA]);
    const clients = await db.query<{ cpf: string }>("select cpf from public.clients");
    assert.deepEqual(clients.rows.map((row) => row.cpf), ["52998224725"]);
    const files = await db.query<{ name: string }>("select name from storage.objects");
    assert.deepEqual(files.rows.map((row) => row.name), [fileA]);
    await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name,owner_id) values ('contract-pdfs',$1,$2)",
      [fileB.replace(lawyerB, lawyerA), lawyerB]));
    const invalidContract = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const orphanPath = `contracts/${lawyerA}/${invalidContract}/cccccccc-cccc-4ccc-8ccc-000000000003.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('contract-pdfs',$1,$2)",
      [orphanPath, lawyerA]);
    await assert.rejects(() => db.query(`select public.create_lawyer_contract(
      $1::uuid,'Cliente Teste','52998224725','2026-10-01'::date,100000::bigint,
      'Cliente próprio',12::smallint,'cash',$2::text,'contrato.pdf',
      '[{"installment_number":1,"kind":"regular","regular_number":1,
        "due_date":"2026-10-10","amount_cents":100000}]'::jsonb
    )`, [invalidContract, orphanPath]));
    await assert.rejects(() => db.query(`select public.create_lawyer_contract(
      $1::uuid,'Cliente Teste','52998224725','2026-10-01'::date,100000::bigint,
      'Cliente próprio',40::smallint,'cash',$2::text,'contrato.pdf',
      '[{"installment_number":1,"kind":"regular","regular_number":1,
        "due_date":"2026-10-10","amount_cents":98000}]'::jsonb
    )`, [invalidContract, orphanPath]));
    const rejected = await db.query<{ count: string }>(
      "select count(*) from public.contracts where id = $1", [invalidContract]);
    assert.equal(Number(rejected.rows[0].count), 0);
    await db.query("delete from storage.objects where name = $1", [orphanPath]);
    await asOwner(db);

    const itemA = await db.query<{ id: string }>(
      "select id from public.installments where contract_id = $1", [contractA]);
    const itemB = await db.query<{ id: string }>(
      "select id from public.installments where contract_id = $1", [contractB]);
    await asUser(db, secretary);
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2026-10-22',1080)",
      [itemA.rows[0].id]);
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2026-10-22',500)",
      [itemB.rows[0].id]);
    const hiddenTerms = await db.query("select contract_id from public.contract_financial_terms");
    assert.equal(hiddenTerms.rows.length, 0);
    const hiddenCommissions = await db.query("select payment_id from public.commissions");
    assert.equal(hiddenCommissions.rows.length, 0);
    await asOwner(db);

    await asUser(db, lawyerA);
    const payments = await db.query<{ amount_paid: string }>("select amount_paid from public.payments");
    assert.equal(payments.rows.length, 1);
    assert.equal(Number(payments.rows[0].amount_paid), 1080);
    const commissions = await db.query<{ commission_amount: string }>("select commission_amount from public.commissions");
    assert.equal(commissions.rows.length, 1);
    assert.equal(Number(commissions.rows[0].commission_amount), 432);
    await assert.rejects(() => db.query(
      "insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2026-10-23',1)",
      [itemA.rows[0].id]));
    await assert.rejects(() => db.query(
      "update public.payments set amount_paid = 2 where installment_id = $1", [itemA.rows[0].id]));
    await assert.rejects(() => db.query(
      "insert into public.commissions(payment_id,lawyer_id,commission_percentage,commission_amount) values (gen_random_uuid(),$1,40,1)",
      [lawyerA]));
    await asOwner(db);
  } finally {
    await db.close();
  }
});

test("secretaria registra recebimentos e notas, mas só corrige os próprios pagamentos via auditoria", async () => {
  const db = new PGlite();
  const secretaryB = "44444444-4444-4444-8444-444444444444";
  try {
    await migrate(db);
    await db.exec(`
      insert into auth.users(id,email) values
        ('${lawyerA}','a@example.com'),('${lawyerB}','b@example.com'),
        ('${secretary}','s@example.com'),('${secretaryB}','s2@example.com');
      update public.profiles set active = true where id in ('${lawyerA}','${lawyerB}');
      update public.profiles set active = true, role = 'secretary' where id in ('${secretary}','${secretaryB}');
    `);
    await createContract(db, lawyerA, contractA, fileA, "52998224725");
    await createContract(db, lawyerB, contractB, fileB, "11144477735");
    const item = await db.query<{ id: string }>(
      "select id from public.installments where contract_id = $1", [contractA]);
    const installmentId = item.rows[0].id;
    const client = await db.query<{ client_id: string }>(
      "select client_id from public.contracts where id = $1", [contractA]);
    const clientId = client.rows[0].client_id;
    await asUser(db, secretary);
    assert.equal((await db.query("select id from public.contracts")).rows.length, 2);
    assert.equal((await db.query("select id from public.installments")).rows.length, 2);
    assert.equal((await db.query("select contract_id from public.contract_financial_terms")).rows.length, 0);
    assert.equal((await db.query("select id from public.commissions")).rows.length, 0);
    assert.equal((await db.query("select id from public.monthly_closings")).rows.length, 0);
    await assert.rejects(() => db.query("update public.contract_financial_terms set commission_percentage = 60"));
    const first = await db.query<{ id: string }>(`
      insert into public.payments(installment_id,payment_date,amount_paid,observation)
      values ($1,'2026-10-10',600,'Pagamento parcial') returning id`, [installmentId]);
    const firstId = first.rows[0].id;
    const second = await db.query<{ id: string }>(`
      insert into public.payments(installment_id,payment_date,amount_paid)
      values ($1,'2026-10-15',400) returning id`, [installmentId]);
    const secondId = second.rows[0].id;
    const note = await db.query<{ id: string; author_id: string }>(`
      insert into public.collection_notes(client_id,contract_id,installment_id,note_type,content)
      values ($1,$2,$3,'collection','Contato inicial') returning id,author_id`,
      [clientId, contractA, installmentId]);
    assert.equal(note.rows[0].author_id, secretary);
    await db.query(`insert into public.collection_notes(client_id,contract_id,installment_id,note_type,content)
      values ($1,$2,$3,'client_reply','Prometeu quitar')`, [clientId, contractA, installmentId]);
    assert.equal((await db.query("select id from public.collection_notes where client_id = $1", [clientId])).rows.length, 2);
    await assert.rejects(() => db.query("delete from public.collection_notes where id = $1", [note.rows[0].id]));
    await assert.rejects(() => db.query("delete from public.payments where id = $1", [firstId]));
    await assert.rejects(() => db.query("update public.payments set amount_paid = 1 where id = $1", [firstId]));
    await asOwner(db);
    const commissionsBefore = await db.query<{ commission_amount: string }>(
      "select commission_amount from public.commissions order by commission_amount");
    assert.deepEqual(commissionsBefore.rows.map((row) => Number(row.commission_amount)), [160, 240]);
    await asUser(db, secretaryB);
    await assert.rejects(() => db.query(
      "select public.revise_secretary_payment($1,'Lançamento incorreto',65000,'2026-10-10')", [firstId]));
    await db.query(`insert into public.payments(installment_id,payment_date,amount_paid)
      values ($1,'2026-10-18',80)`, [installmentId]);
    await asUser(db, secretary);
    await db.query("select public.revise_secretary_payment($1,'Corrigir valor parcial',65000,'2026-10-11')", [firstId]);
    const active = await db.query<{ amount_paid: string; replaces_payment_id: string | null }>(
      "select amount_paid,replaces_payment_id from public.payments where installment_id=$1 and voided_at is null order by amount_paid",
      [installmentId]);
    assert.deepEqual(active.rows.map((row) => Number(row.amount_paid)), [80, 400, 650]);
    assert.equal(active.rows[2].replaces_payment_id, firstId);
    await assert.rejects(() => db.query(
      "select public.revise_secretary_payment($1,'Estorno duplicado',null,null)", [firstId]));
    await db.query("select public.revise_secretary_payment($1,'Pagamento duplicado',null,null)", [secondId]);
    assert.equal((await db.query("select id from public.audit_logs")).rows.length, 0);
    await asOwner(db);
    const audits = await db.query<{ field_name: string; reason: string }>(
      "select field_name,reason from public.audit_logs where field_name='payment_state' order by created_at");
    assert.equal(audits.rows.length, 2);
    assert.ok(audits.rows.every((row) => row.field_name === "payment_state" && row.reason.length > 4));
    const finalCommissions = await db.query<{ commission_amount: string }>(
      "select commission_amount from public.commissions order by commission_amount");
    assert.deepEqual(finalCommissions.rows.map((row) => Number(row.commission_amount)), [32, 160, 240, 260]);
    await asUser(db, lawyerA);
    assert.equal((await db.query("select id from public.payments")).rows.length, 4);
    assert.equal((await db.query("select id from public.commissions")).rows.length, 4);
    await asOwner(db);
  } finally { await db.close(); }
});
