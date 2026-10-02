import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const lawyerA = "11111111-1111-4111-8111-111111111111";
const lawyerB = "22222222-2222-4222-8222-222222222222";
const secretary = "33333333-3333-4333-8333-333333333333";
const manager = "44444444-4444-4444-8444-444444444444";
const admin = "55555555-5555-4555-8555-555555555555";
const invited = "66666666-6666-4666-8666-666666666666";

async function setup() {
  const db = new PGlite();
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
  for (const name of ["20261001000100_schema.sql", "20261001000200_rls.sql",
    "20261001000300_storage.sql", "20261001000400_lawyer_contracts.sql",
    "20261001000500_secretary_operations.sql", "20261002000100_closings_management.sql",
    "20261002000200_payment_integrity.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into auth.users(id,email) values
      ('${lawyerA}','a@example.com'),('${lawyerB}','b@example.com'),
      ('${secretary}','s@example.com'),('${manager}','m@example.com'),
      ('${admin}','admin@example.com'),('${invited}','invite@example.com');
    update public.profiles set active=true where id in ('${lawyerA}','${lawyerB}');
    update public.profiles set role='secretary',active=true where id='${secretary}';
    update public.profiles set role='manager',active=true where id='${manager}';
    update public.profiles set role='admin',active=true where id='${admin}';
    insert into public.clients(full_name,cpf) values ('Cliente Teste','52998224725');
    insert into public.contracts(client_id,lawyer_id,origin,total_contract_value,contract_date)
      select id,'${lawyerA}','Cliente próprio',1000,'2024-08-01' from public.clients;
    insert into public.contract_financial_terms(contract_id,commission_percentage)
      select id,40 from public.contracts;
    insert into public.installments(contract_id,installment_number,regular_number,due_date,contractual_amount)
      select id,1,1,'2024-09-10',1000 from public.contracts;
    insert into public.clients(full_name,cpf) values ('Outro Cliente','11144477735');
    insert into public.contracts(client_id,lawyer_id,origin,total_contract_value,contract_date)
      select id,'${lawyerB}','Tráfego HP',500,'2024-08-01' from public.clients where cpf='11144477735';
    insert into public.contract_financial_terms(contract_id,commission_percentage)
      select id,20 from public.contracts where lawyer_id='${lawyerB}';
    insert into public.installments(contract_id,installment_number,regular_number,due_date,contractual_amount)
      select id,1,1,'2024-09-20',500 from public.contracts where lawyer_id='${lawyerB}';
  `);
  const installment = (await db.query<{ id: string }>(
    "select i.id from public.installments i join public.contracts c on c.id=i.contract_id where c.lawyer_id=$1", [lawyerA])).rows[0].id;
  return { db, installment };
}

async function asUser(db: PGlite, id: string) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function asOwner(db: PGlite) {
  await db.exec("reset role");
  await db.exec("reset request.jwt.claim.sub");
}

test("manager fecha pela data do recebimento, preserva itens e registra repasses parciais", async () => {
  const { db, installment } = await setup();
  try {
    await asUser(db, secretary);
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2024-09-30',600)", [installment]);
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2024-09-30',480)", [installment]);
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2024-10-01',100)", [installment]);
    assert.equal((await db.query("select * from public.monthly_closings")).rows.length, 0);
    await assert.rejects(() => db.query("select public.confirm_monthly_closing($1,9::smallint,2024::smallint)", [lawyerA]));
    await asUser(db, manager);
    assert.equal((await db.query("select id from public.contracts")).rows.length, 2);
    const close = await db.query<{ confirm_monthly_closing: string }>(
      "select public.confirm_monthly_closing($1,9::smallint,2024::smallint)", [lawyerA]);
    const id = close.rows[0].confirm_monthly_closing;
    const snap = (await db.query<{ office_amount_received: string; commission_amount: string; amount_pending_transfer: string }>(
      "select office_amount_received,commission_amount,amount_pending_transfer from public.monthly_closings where id=$1", [id])).rows[0];
    assert.equal(Number(snap.office_amount_received), 1080);
    assert.equal(Number(snap.commission_amount), 432);
    assert.equal(Number(snap.amount_pending_transfer), 432);
    assert.equal((await db.query("select * from public.monthly_closing_items where closing_id=$1", [id])).rows.length, 2);
    await assert.rejects(() => db.query("select public.confirm_monthly_closing($1,9::smallint,2024::smallint)", [lawyerA]));
    const october = (await db.query<{ confirm_monthly_closing: string }>(
      "select public.confirm_monthly_closing($1,10::smallint,2024::smallint)", [lawyerA])).rows[0].confirm_monthly_closing;
    const octoberSnapshot = (await db.query<{ office_amount_received: string; commission_amount: string }>(
      "select office_amount_received,commission_amount from public.monthly_closings where id=$1", [october])).rows[0];
    assert.equal(Number(octoberSnapshot.office_amount_received), 100);
    assert.equal(Number(octoberSnapshot.commission_amount), 40);
    await db.query("select public.register_commission_transfer($1,20000::bigint,'2024-10-20'::date,'Primeira parte')", [id]);
    assert.equal(Number((await db.query<{ amount_pending_transfer: string }>(
      "select amount_pending_transfer from public.monthly_closings where id=$1", [id])).rows[0].amount_pending_transfer), 232);
    await assert.rejects(() => db.query(
      "select public.register_commission_transfer($1,23300::bigint,'2024-10-20'::date,'Excesso')", [id]));
    await db.query("select public.register_commission_transfer($1,23200::bigint,'2024-10-21'::date,'Segunda parte')", [id]);
    assert.equal((await db.query<{ status: string }>(
      "select status from public.monthly_closings where id=$1", [id])).rows[0].status, "paid");
    const transfer = (await db.query<{ id: string }>(
      "select id from public.commission_transfers where closing_id=$1 order by amount desc limit 1", [id])).rows[0].id;
    await db.query("select public.reverse_commission_transfer($1,'Transferência duplicada')", [transfer]);
    assert.equal((await db.query<{ status: string }>(
      "select status from public.monthly_closings where id=$1", [id])).rows[0].status, "partial");
    await asUser(db, lawyerB);
    assert.equal((await db.query("select id from public.monthly_closings")).rows.length, 0);
    assert.equal((await db.query("select id from public.commission_transfers")).rows.length, 0);
    assert.equal((await db.query("select id from public.monthly_closing_items")).rows.length, 0);
    await asUser(db, lawyerA);
    assert.equal((await db.query("select id from public.monthly_closing_items where closing_id=$1", [id])).rows.length, 2);
    await assert.rejects(() => db.query("update public.monthly_closings set commission_amount=1 where id=$1", [id]));
    await asUser(db, secretary);
    assert.equal((await db.query("select id from public.monthly_closing_items")).rows.length, 0);
    assert.equal((await db.query("select id from public.commission_transfers")).rows.length, 0);
    assert.equal((await db.query("select id from public.closing_adjustments")).rows.length, 0);
    await assert.rejects(() => db.query(
      "insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2024-09-28',100)", [installment]));
    await asUser(db, manager);
    await assert.rejects(() => db.query(
      "insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2024-09-28',100)", [installment]));
    await db.query("select public.manager_record_payment($1,'2024-09-28'::date,10000::bigint,'','Recebimento antigo lançado depois')", [installment]);
    assert.equal(Number((await db.query<{ adjustment_amount: string }>(
      "select adjustment_amount from public.monthly_closings where id=$1", [id])).rows[0].adjustment_amount), 40);
    assert.equal((await db.query("select id from public.monthly_closing_items where closing_id=$1", [id])).rows.length, 2);
  } finally { await db.close(); }
});

test("correção gerencial após fechamento preserva snapshot, cria ajuste, auditoria e notificação", async () => {
  const { db, installment } = await setup();
  try {
    await asUser(db, secretary);
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values ($1,'2024-09-30',1000)", [installment]);
    await asUser(db, manager);
    const closing = (await db.query<{ confirm_monthly_closing: string }>(
      "select public.confirm_monthly_closing($1,9::smallint,2024::smallint)", [lawyerA])).rows[0].confirm_monthly_closing;
    const payment = (await db.query<{ id: string }>("select id from public.payments")).rows[0].id;
    await assert.rejects(() => db.query("select public.revise_manager_payment($1,'não',90000::bigint,'2024-09-30'::date)", [payment]));
    await db.query("select public.revise_manager_payment($1,'Correção informada pelo cliente',90000::bigint,'2024-09-30'::date)", [payment]);
    const result = (await db.query<{ commission_amount: string; adjustment_amount: string; amount_pending_transfer: string }>(
      "select commission_amount,adjustment_amount,amount_pending_transfer from public.monthly_closings where id=$1", [closing])).rows[0];
    assert.equal(Number(result.commission_amount), 400);
    assert.equal(Number(result.adjustment_amount), -40);
    assert.equal(Number(result.amount_pending_transfer), 360);
    assert.equal((await db.query("select id from public.monthly_closing_items where closing_id=$1", [closing])).rows.length, 1);
    assert.equal((await db.query("select id from public.closing_adjustments where closing_id=$1", [closing])).rows.length, 2);
    assert.equal((await db.query("select id from public.audit_logs where table_name='payments' and field_name='payment_state'")).rows.length, 1);
    assert.equal((await db.query("select id from public.notifications where user_id=$1", [lawyerA])).rows.length, 1);
    await asUser(db, lawyerB);
    assert.equal((await db.query("select id from public.notifications")).rows.length, 0);
    await asUser(db, manager);
    const contract = (await db.query<{ id: string }>("select id from public.contracts where lawyer_id=$1", [lawyerA])).rows[0].id;
    await db.query("select public.correct_manager_field('contract_financial_terms',$1,'commission_percentage','50','Percentual contratual corrigido')", [contract]);
    assert.equal(Number((await db.query<{ amount_pending_transfer: string }>(
      "select amount_pending_transfer from public.monthly_closings where id=$1", [closing])).rows[0].amount_pending_transfer), 450);
    const client = (await db.query<{ id: string }>("select id from public.clients where cpf='52998224725'")).rows[0].id;
    await db.query("select public.correct_manager_field('clients',$1,'full_name','Cliente Corrigido','Correção cadastral solicitada')", [client]);
    assert.equal((await db.query<{ full_name: string }>("select full_name from public.clients where id=$1", [client])).rows[0].full_name,
      "Cliente Corrigido");
    await db.query("select public.correct_manager_field('contracts',$1,'total_contract_value','1200.00','Aditivo contratual assinado')", [contract]);
    assert.equal(Number((await db.query<{ total_contract_value: string }>(
      "select total_contract_value from public.contracts where id=$1", [contract])).rows[0].total_contract_value), 1200);
    await db.query("select public.correct_manager_field('installments',$1,'due_date','2024-09-15','Renegociação registrada')", [installment]);
    assert.equal((await db.query<{ due_date: string }>(
      "select due_date::text from public.installments where id=$1", [installment])).rows[0].due_date, "2024-09-15");
    await asUser(db, lawyerA);
    const notification = (await db.query<{ id: string }>(
      "select id from public.notifications where read_at is null limit 1")).rows[0].id;
    await db.query("update public.notifications set read_at=now() where id=$1", [notification]);
    assert.equal((await db.query("select id from public.notifications where id=$1 and read_at is null", [notification])).rows.length, 0);
    await asUser(db, lawyerB);
    assert.equal((await db.query("select id from public.notifications where id=$1", [notification])).rows.length, 0);
    await asOwner(db);
    const log = (await db.query<{ id: string }>(
      "select id from public.audit_logs where field_name='payment_state' limit 1")).rows[0].id;
    await assert.rejects(() => db.query("update public.audit_logs set reason='alterado' where id=$1", [log]));
    await assert.rejects(() => db.query("delete from public.audit_logs where id=$1", [log]));
  } finally { await db.close(); }
});

test("admin gerencia role e ativação com log; demais perfis são bloqueados", async () => {
  const { db } = await setup();
  try {
    await asUser(db, manager);
    await assert.rejects(() => db.query("select public.admin_update_profile($1,'Nova pessoa','secretary',true,'Convite novo')", [invited]));
    await asUser(db, secretary);
    await assert.rejects(() => db.query("select public.admin_update_profile($1,'Nova pessoa','secretary',true,'Convite novo')", [invited]));
    await asUser(db, admin);
    await db.query("select public.admin_update_profile($1,'Nova pessoa','secretary',true,'Convite novo')", [invited]);
    let profile = (await db.query<{ role: string; active: boolean }>("select role,active from public.profiles where id=$1", [invited])).rows[0];
    assert.deepEqual(profile, { role: "secretary", active: true });
    await db.query("select public.admin_update_profile($1,'Nova pessoa','manager',false,'Mudança de equipe')", [invited]);
    profile = (await db.query<{ role: string; active: boolean }>("select role,active from public.profiles where id=$1", [invited])).rows[0];
    assert.deepEqual(profile, { role: "manager", active: false });
    assert.equal((await db.query("select id from public.audit_logs where table_name='profiles' and record_id=$1", [invited])).rows.length, 5);
    await assert.rejects(() => db.query("update public.profiles set role='admin' where id=$1", [invited]));
    await asOwner(db);
    assert.equal((await db.query("select id from public.audit_logs where table_name='profiles' and record_id=$1", [invited])).rows.length, 5);
  } finally { await db.close(); }
});
