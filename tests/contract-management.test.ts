import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { contractToForm, parseEditValues, prepareContractEdit } from "../src/lib/contracts/editing";
import { blankContractForm, prepareContract } from "../src/lib/contracts/registration";

const values = { ...blankContractForm, clientName: "Cliente Teste", cpf: "52998224725", serviceName: "Ação revisional",
  contractDate: "22/10/2026", total: "1.200,00", method: "cash" as const, installmentValue: "1.200,00",
  count: "1", paymentStartType: "fixed_date" as const, firstDue: "10/12/2026", origin: "Cliente próprio", percentage: "45" };

test("edição reutiliza validação e cronograma, preservando a identificação do cliente", () => {
  const result = prepareContractEdit(values, false);
  assert.equal("total_contract_value" in result.changes && result.changes.total_contract_value, 1200);
  assert.equal(result.schedule?.[0].amount_cents, 120000);
  assert.throws(() => prepareContractEdit({ ...values, total: "1.100,00" }, false), /cronograma/);
  assert.throws(() => parseEditValues({ ...values, hasEntry: "false" }), /dados/);
  assert.deepEqual(prepareContractEdit(values, true).changes, { origin: "Cliente próprio", contract_date: "2026-10-22", service_name: "Ação revisional" });
  assert.throws(() => prepareContract({ ...values, cpf: "" }), /CPF/);
});

test("contrato condicionado carrega condições e parcelas previstas mesmo sem cronograma", () => {
  const form = contractToForm({ id: "id", client_id: "client", client_name: "Cliente", client_cpf: null,
    origin: "Cliente próprio", service_name: "Ação revisional", contract_date: "2026-10-22", total_contract_value: 3000,
    payment_method: "installments", payment_start_type: "condition", payment_start_condition: "Após liberação dos valores",
    installment_count: 3, installment_amount: 1000, commission_percentage: 40,
    contract_file_path: null, contract_file_name: null, installments: [] });
  assert.equal(form.count, "3");
  assert.equal(form.firstDue, "");
  const edited = prepareContractEdit(form, false);
  assert.deepEqual(edited.schedule, []);
  assert.equal("payment_start_condition" in edited.changes && edited.changes.payment_start_condition, "Após liberação dos valores");
});

test("gestão de contratos aplica isolamento, validação, auditoria e proteção do histórico no banco", async () => {
  const db = new PGlite();
  const lawyer = randomUUID(), colleague = randomUUID(), other = randomUUID(), secretary = randomUUID(), otherOffice = randomUUID();
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
    for (const file of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()) {
      try { await db.exec(await readFile(new URL(file, migrations), "utf8")); }
      catch (cause) { const error = cause as { message: string; position?: string; where?: string }; throw new Error(`${file}: ${error.message} (posição ${error.position ?? "?"}) ${error.where ?? ""}`); }
    }
    const office = (await db.query<{ id: string }>("select id from public.offices where slug='principal'")).rows[0].id;
    await db.query("insert into public.offices(id,name,slug) values($1,'Outro escritório','other')", [otherOffice]);
    for (const [id, targetOffice, role] of [[lawyer, office, "lawyer"], [colleague, office, "lawyer"], [other, otherOffice, "lawyer"], [secretary, office, "secretary"]]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.com`]);
      await db.query("update public.profiles set active=true,office_id=$2,role=$3 where id=$1", [id, targetOffice, role]);
    }
    const asUser = async (id: string) => { await db.exec("set role authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); };
    const version = async (id: string) => (await db.query<{ version: string }>("select updated_at::text as version from public.contracts where id=$1", [id])).rows[0].version;
    const register = async (id: string) => db.query(`select public.create_lawyer_contract_v2(
      $1::uuid,'Cliente Teste','52998224725','2026-10-01'::date,100000::bigint,'Cliente próprio',40::smallint,'cash',null,null,
      '[{"installment_number":1,"kind":"regular","regular_number":1,"due_date":"2026-12-10","amount_cents":100000}]'::jsonb,
      'fixed_date','2026-12-10'::date,null,1,100000::bigint,false,null,null,null,null)`, [id]);
    const prepared = prepareContractEdit(values, false);
    const edit = (id: string, stamp: string, changes: object = prepared.changes, schedule: unknown = prepared.schedule) => db.query(
      "select public.edit_lawyer_contract($1::uuid,$2::timestamptz,$3::jsonb,$4::jsonb,'Correção solicitada pela advogada')",
      [id, stamp, JSON.stringify(changes), schedule === null ? null : JSON.stringify(schedule)]);
    const remove = (id: string, stamp: string) => db.query("select public.delete_lawyer_contract($1::uuid,$2::timestamptz,'Cadastro duplicado identificado')", [id, stamp]);

    await asUser(lawyer);
    const id = randomUUID(); await register(id); const firstVersion = await version(id);
    for (const actor of [colleague, other, secretary]) {
      await asUser(actor);
      await assert.rejects(edit(id, firstVersion), /indisponível|autorizado/);
      await assert.rejects(remove(id, firstVersion), /indisponível|autorizado/);
    }
    await asUser(lawyer);
    await assert.rejects(db.query("update public.contracts set total_contract_value=1 where id=$1", [id]), /permission denied/);
    await assert.rejects(edit(id, firstVersion, { ...prepared.changes, lawyer_id: colleague }), /Campo não permitido/);
    await assert.rejects(edit(id, firstVersion, { ...prepared.changes, total_contract_value: 1200.001 }), /Valor financeiro inválido/);
    await assert.rejects(edit(id, firstVersion, prepared.changes, [{ ...prepared.schedule![0], amount_cents: 119999 }]), /Valor, ordem/);
    await edit(id, firstVersion);
    assert.equal(Number((await db.query<{ total_contract_value: string }>("select total_contract_value from public.contracts where id=$1", [id])).rows[0].total_contract_value), 1200);
    assert.equal(Number((await db.query<{ commission_percentage: string }>("select commission_percentage from public.contract_financial_terms where contract_id=$1", [id])).rows[0].commission_percentage), 45);
    await assert.rejects(edit(id, firstVersion), /foi alterado/);
    assert.ok((await db.query("select id from public.audit_logs where record_id=$1 and field_name='commission_percentage'", [id])).rows.length);

    const success = prepareContractEdit({ ...values, method: "success_only", successFeePercentage: "30" }, false);
    await edit(id, await version(id), success.changes, success.schedule);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [id])).rows.length, 0);
    await edit(id, await version(id));
    const installment = (await db.query<{ id: string }>("select id from public.installments where contract_id=$1", [id])).rows[0].id;
    await assert.rejects(edit(id, await version(id), { commission_percentage: 60 }, null), /exige revisão/);
    await remove(id, await version(id));
    assert.equal((await db.query("select id from public.contracts where id=$1", [id])).rows.length, 0);
    assert.equal((await db.query("select id from public.installments where id=$1", [installment])).rows.length, 0);
    await asUser(secretary);
    assert.equal((await db.query("select id from public.contracts where id=$1", [id])).rows.length, 0);
    await assert.rejects(db.query("insert into public.payments(installment_id,payment_date,amount_paid) values($1,'2026-12-10',100)", [installment]), /Contrato indisponível/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    assert.equal((await db.query("select id from public.contracts where id=$1 and deleted_at is not null", [id])).rows.length, 1);
    assert.equal((await db.query("select id from public.installments where id=$1", [installment])).rows.length, 1);

    await asUser(lawyer);
    const paid = randomUUID(); await register(paid);
    const paidInstallment = (await db.query<{ id: string }>("select id from public.installments where contract_id=$1", [paid])).rows[0].id;
    await asUser(secretary);
    const payment = (await db.query<{ id: string }>("insert into public.payments(installment_id,payment_date,amount_paid) values($1,'2026-12-10',1080) returning id", [paidInstallment])).rows[0].id;
    await asUser(lawyer);
    await assert.rejects(edit(paid, await version(paid)), /histórico de pagamentos/);
    await assert.rejects(remove(paid, await version(paid)), /pagamentos registrados/);
    await edit(paid, await version(paid), { origin: "Tráfego HP" }, null);
    assert.equal(Number((await db.query<{ commission_amount: string }>("select commission_amount from public.commissions where payment_id=$1", [payment])).rows[0].commission_amount), 432);
    await asUser(secretary);
    await db.query("select public.revise_secretary_payment($1::uuid,'Lançamento registrado incorretamente',null::bigint,null::date)", [payment]);
    await asUser(lawyer);
    await assert.rejects(remove(paid, await version(paid)), /pagamentos registrados/);
    await assert.rejects(edit(paid, await version(paid)), /histórico de pagamentos/);
    const noted = randomUUID(); await register(noted);
    const notedInstallment = (await db.query<{ id: string }>("select id from public.installments where contract_id=$1", [noted])).rows[0].id;
    await asUser(secretary);
    await db.query(`insert into public.collection_notes(client_id,contract_id,installment_id,note_type,content)
      select client_id,id,$2,'collection','Cliente contatado sobre a parcela' from public.contracts where id=$1`, [noted, notedInstallment]);
    await asUser(lawyer);
    await assert.rejects(edit(noted, await version(noted)), /histórico de pagamentos ou cobranças/);
    const oldVersion = await version(noted);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.query("update public.installments set due_date='2027-01-10' where id=$1", [notedInstallment]);
    await asUser(lawyer);
    await assert.rejects(edit(noted, oldVersion, { origin: "Tráfego HP" }, null), /foi alterado/);
    await assert.rejects(edit(noted, await version(noted), { contract_file_path: `contracts/${other}/${noted}/${randomUUID()}.pdf`, contract_file_name: "outro.pdf" }, null), /PDF não encontrado/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec(await readFile(new URL("20261022000300_lawyer_contract_management.sql", migrations), "utf8"));
    await asUser(lawyer);
    const multi = randomUUID();
    const parties = [{ fullName: "Cliente Teste", cpf: "52998224725" }, { fullName: "Segunda Pessoa Fictícia", cpf: "11144477735" }];
    const createMulti = (contractId: string, people = parties) => db.query(`select public.create_contract_with_parties(
      $1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,null,null)`, [contractId, JSON.stringify(people), JSON.stringify(prepared.changes), JSON.stringify(prepared.schedule)]);
    await createMulti(multi);
    const links = (await db.query<{ client_id: string }>("select client_id from public.contract_parties where contract_id=$1 order by position", [multi])).rows;
    assert.equal(links.length, 2);
    assert.equal((await db.query(`select cl.id from public.contract_parties p join public.clients cl on cl.id=p.client_id
      where p.contract_id=$1`, [multi])).rows.length, 2);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [multi])).rows.length, 1);
    const entryPlan = prepareContractEdit({ ...values, method: "installments", total: "3.000,00", count: "4",
      installmentValue: "650,00", hasEntry: true, entryValue: "400,00", entryDue: "04/06/2026", firstDue: "10/07/2026" }, false);
    const entryId = randomUUID();
    await db.query("select public.create_contract_with_parties($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",
      [entryId, JSON.stringify(parties), JSON.stringify(entryPlan.changes), JSON.stringify(entryPlan.schedule)]);
    const entryTotal = (await db.query<{ count: number; total: string }>("select count(*)::integer as count,sum(contractual_amount) as total from public.installments where contract_id=$1", [entryId])).rows[0];
    assert.equal(entryTotal.count, 5); assert.equal(Number(entryTotal.total), 3000);
    const successPlan = prepareContractEdit({ ...values, method: "success_only", successFeePercentage: "30" }, false);
    const multiSuccess = randomUUID();
    await db.query("select public.create_contract_with_parties($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",
      [multiSuccess, JSON.stringify(parties), JSON.stringify(successPlan.changes), JSON.stringify(successPlan.schedule)]);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [multiSuccess])).rows.length, 0);
    await assert.rejects(createMulti(randomUUID(), [parties[0], parties[0]]), /mesmo CPF/);
    const failedId = randomUUID();
    await assert.rejects(createMulti(failedId, [parties[0], { ...parties[1], cpf: "11144477700" }]), /CPF válido/);
    assert.equal((await db.query("select id from public.contracts where id=$1", [failedId])).rows.length, 0);
    await assert.rejects(db.query("delete from public.contract_parties where contract_id=$1", [multi]), /permission denied/);
    await asUser(colleague);
    assert.equal((await db.query("select client_id from public.contract_parties where contract_id=$1", [multi])).rows.length, 0);
    assert.equal((await db.query("select id from public.clients where id=$1", [links[1].client_id])).rows.length, 0);
    await asUser(other);
    assert.equal((await db.query("select client_id from public.contract_parties where contract_id=$1", [multi])).rows.length, 0);
    await asUser(secretary);
    assert.equal((await db.query("select client_id from public.contract_parties where contract_id=$1", [multi])).rows.length, 2);
    await assert.rejects(createMulti(randomUUID()), /autorizado/);
    const multiInstallment = (await db.query<{ id: string }>("select id from public.installments where contract_id=$1", [multi])).rows[0].id;
    await db.query(`insert into public.collection_notes(client_id,contract_id,installment_id,note_type,content)
      values($1,$2,$3,'collection','Contato com o segundo contratante')`, [links[1].client_id, multi, multiInstallment]);
    const multiPayment = (await db.query<{ id: string }>("insert into public.payments(installment_id,payment_date,amount_paid) values($1,'2026-12-10',1200) returning id", [multiInstallment])).rows[0].id;
    assert.equal((await db.query("select id from public.commissions where payment_id=$1", [multiPayment])).rows.length, 0);
    await asUser(lawyer);
    assert.equal(Number((await db.query<{ commission_amount: string }>("select commission_amount from public.commissions where payment_id=$1", [multiPayment])).rows[0].commission_amount), 540);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec(await readFile(new URL("20261022000400_multiple_contractors.sql", migrations), "utf8"));
  } finally { await db.close(); }
});
