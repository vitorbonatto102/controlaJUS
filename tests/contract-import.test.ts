import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ContractExtractionError, extractContractData, parseContractText } from "../src/lib/contracts/extraction";
import { blankContractForm, prepareContract } from "../src/lib/contracts/registration";

const prefix = `CONTRATANTE: ALEXANDRE PINALLI GHENO, brasileiro, inscrito no CPF sob o nº 724.787.130-04.
2. DOS HONORÁRIOS ADVOCATÍCIOS
2.1. O valor total dos honorários advocatícios a serem pagos pelo CONTRATANTE à CONTRATADA é de R$ 4.000,00
(quatro mil reais), a serem pagos em 20 (vinte) parcelas mensais e sucessivas de R$ 200,00 cada,`;
const additional = `2.1.1 Além do valor acima descrito, o CONTRATANTE pagará à CONTRATADA o valor equivalente a
30% sobre o proveito econômico proveniente dos serviços prestados, se aplicável.`;
const footer = `Cruz Alta-RS, 21 de Maio de 2026.`;

test("parser identifica parcelamento com vencimento expresso", () => {
  const data = parseContractText(`${prefix} com vencimento em 10/06/2026. ${footer}`);
  assert.equal(data.contractorName, "ALEXANDRE PINALLI GHENO");
  assert.equal(data.cpf, "724.787.130-04");
  assert.equal(data.contractDate, "21/05/2026");
  assert.equal(data.totalValue, "4.000,00");
  assert.equal(data.paymentType, "installments");
  assert.equal(data.installmentCount, 20);
  assert.equal(data.installmentValue, "200,00");
  assert.equal(data.firstDueDate, "10/06/2026");
  assert.equal(data.paymentStartType, "fixed_date");
});

test("parser preserva início condicionado sem inventar vencimento", () => {
  const data = parseContractText(`${prefix} o início dos pagamentos ocorrerá somente após a efetiva liberação,
  em favor do CONTRATANTE, dos valores referentes à indenização e/ou ressarcimento. ${additional} ${footer}`);
  assert.equal(data.firstDueDate, null);
  assert.equal(data.paymentStartType, "condition");
  assert.match(data.paymentStartCondition ?? "", /efetiva liberação.*indenização e\/ou ressarcimento/i);
  assert.equal(data.hasAdditionalFee, true);
  assert.equal(data.additionalFeePercentage, 30);
  assert.equal(data.additionalFeeBasis, "proveito econômico");
});

test("parser identifica à vista e ausência de honorários adicionais", () => {
  const data = parseContractText(`CONTRATANTE: Maria Silva, brasileira, inscrita no CPF sob o nº 529.982.247-25.
    2.1. O valor total dos honorários advocatícios é de R$ 1.000,00, pagamento à vista,
    com vencimento em 05/10/2026. ${footer}`);
  assert.equal(data.paymentType, "cash");
  assert.equal(data.installmentCount, null);
  assert.equal(data.installmentValue, "1.000,00");
  assert.equal(data.firstDueDate, "05/10/2026");
  assert.equal(data.hasAdditionalFee, false);
  assert.equal(data.additionalFeePercentage, null);
  assert.equal(data.additionalFeeBasis, null);
});

test("parser tolera espaços e quebras simples", () => {
  const data = parseContractText(`CONTRATANTE :  ALEXANDRE PINALLI GHENO ,\n inscrito no CPF sob o n. 724.787.130-04.
    2.1. O valor total dos honorários advocatícios\n é de R$ 4.000,00,
    a serem pagos em 20 (vinte) parcelas mensais e sucessivas de R$ 200,00 cada.
    Vencimento da primeira parcela em 10 de Junho de 2026. ${footer}`);
  assert.equal(data.contractorName, "ALEXANDRE PINALLI GHENO");
  assert.equal(data.installmentCount, 20);
  assert.equal(data.firstDueDate, "10/06/2026");
});

test("âncoras ausentes deixam campos nulos", () => {
  const data = parseContractText("Texto livre sem campos contratuais identificáveis.");
  assert.equal(data.contractorName, null);
  assert.equal(data.cpf, null);
  assert.equal(data.contractDate, null);
  assert.equal(data.totalValue, null);
  assert.equal(data.paymentType, null);
  assert.equal(data.installmentCount, null);
  assert.equal(data.firstDueDate, null);
  assert.equal(data.paymentStartCondition, null);
  assert.equal(data.hasAdditionalFee, false);
});

function blankPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

test("PDF inválido ou sem texto extraível é recusado", async () => {
  await assert.rejects(extractContractData(new Uint8Array(Buffer.from("not a pdf"))), ContractExtractionError);
  await assert.rejects(extractContractData(blankPdf()), /não contém texto extraível/i);
});

test("revisão condicionada não gera cronograma nem soma adicional à comissão", () => {
  const preview = prepareContract({ ...blankContractForm,
    clientName: "ALEXANDRE PINALLI GHENO", cpf: "724.787.130-04",
    contractDate: "21/05/2026", total: "R$ 4.000,00", method: "installments",
    count: "20", installmentValue: "R$ 200,00", paymentStartType: "condition",
    paymentStartCondition: "Após a efetiva liberação dos valores de indenização.",
    origin: "Cliente próprio", percentage: "40", hasAdditionalFee: true,
    additionalFeePercentage: "30", additionalFeeBasis: "proveito econômico",
  });
  assert.deepEqual(preview.rows, []);
  assert.equal(preview.differenceCents, 0);
  assert.equal(preview.totalCents, 400000);
  assert.equal(preview.additionalFeeAmountCents, null);
  assert.equal(preview.percentage, 40);
});

test("diferença legítima de centavo exige última parcela explícita", () => {
  const values = { ...blankContractForm, clientName: "Cliente Teste", cpf: "52998224725",
    contractDate: "21/05/2026", total: "R$ 1.000,00", method: "installments" as const,
    count: "3", installmentValue: "R$ 333,33", paymentStartType: "fixed_date" as const,
    firstDue: "10/06/2026", origin: "Cliente próprio", percentage: "40" };
  assert.equal(prepareContract(values).differenceCents, 1);
  const corrected = prepareContract({ ...values, lastInstallmentValue: "R$ 333,34" });
  assert.equal(corrected.differenceCents, 0);
  assert.equal(corrected.rows[2].amount_cents, 33334);
});

const lawyer = "11111111-1111-4111-8111-111111111111";
const otherLawyer = "22222222-2222-4222-8222-222222222222";
const secretary = "33333333-3333-4333-8333-333333333333";
const contractId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function database() {
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
    "20261002000200_payment_integrity.sql", "20261002000300_contract_import.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  // Projetos que aplicam SQL manualmente podem reenviar este arquivo após uma falha parcial.
  await db.exec(await readFile(new URL("../supabase/migrations/20261002000300_contract_import.sql", import.meta.url), "utf8"));
  await db.exec(`
    insert into auth.users(id,email) values
      ('${lawyer}','a@example.com'),('${otherLawyer}','b@example.com'),
      ('${secretary}','s@example.com');
    update public.profiles set active=true where id in ('${lawyer}','${otherLawyer}');
    update public.profiles set role='secretary',active=true where id='${secretary}';
  `);
  return db;
}

async function asUser(db: PGlite, id: string) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}

test("migração grava contrato condicionado manual sem parcelas e isola termos internos", async () => {
  const db = await database();
  try {
    await asUser(db, lawyer);
    const result = await db.query<{ create_lawyer_contract_v2: string }>(`
      select public.create_lawyer_contract_v2(
        $1::uuid, 'Cliente Teste', '52998224725', '2026-05-21'::date,
        400000::bigint, 'Cliente próprio', 40::smallint, 'installments',
        null::text, null::text, '[]'::jsonb, 'condition', null::date,
        'Após a efetiva liberação dos valores de indenização.', 20, 20000::bigint,
        true, 30::numeric, 'proveito econômico', null::bigint, null::bigint
      )`, [contractId]);
    assert.equal(result.rows[0].create_lawyer_contract_v2, contractId);
    const contract = (await db.query<{ first_due_date: string | null; has_additional_fee: boolean;
      additional_fee_percentage: string; additional_fee_amount: string | null }>(`
      select first_due_date, has_additional_fee, additional_fee_percentage,
        additional_fee_amount from public.contracts where id=$1`, [contractId])).rows[0];
    assert.equal(contract.first_due_date, null);
    assert.equal(contract.has_additional_fee, true);
    assert.equal(Number(contract.additional_fee_percentage), 30);
    assert.equal(contract.additional_fee_amount, null);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [contractId])).rows.length, 0);
    assert.equal((await db.query<{ commission_percentage: string }>(
      "select commission_percentage from public.contract_financial_terms where contract_id=$1", [contractId]))
      .rows[0].commission_percentage, "40.00");
    const adjustedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query(`select public.create_lawyer_contract_v2(
      $1::uuid, 'Outro Cliente', '11144477735', '2026-05-21'::date,
      100000::bigint, 'Cliente próprio', 40::smallint, 'installments',
      null::text, null::text, '[]'::jsonb, 'condition', null::date,
      'Após confirmação de recebimento.', 3, 33333::bigint,
      false, null::numeric, null::text, null::bigint, 33334::bigint
    )`, [adjustedId]);
    assert.equal(Number((await db.query<{ last_installment_amount: string }>(
      "select last_installment_amount from public.contracts where id=$1", [adjustedId]))
      .rows[0].last_installment_amount), 333.34);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [adjustedId])).rows.length, 0);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [otherLawyer]);
    assert.equal((await db.query("select id from public.contracts where id=$1", [contractId])).rows.length, 0);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [secretary]);
    assert.equal((await db.query("select contract_id from public.contract_financial_terms where contract_id=$1", [contractId])).rows.length, 0);
  } finally { await db.close(); }
});

test("migração aceita PDF com vencimento fixo e rejeita cronograma fictício", async () => {
  const db = await database();
  const filePath = `contracts/${lawyer}/${contractId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
  try {
    await asUser(db, lawyer);
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('contract-pdfs',$1,$2)",
      [filePath, lawyer]);
    const schedule = JSON.stringify([{ installment_number: 1, kind: "regular",
      regular_number: 1, due_date: "2026-10-05", amount_cents: 100000 }]);
    await db.query(`select public.create_lawyer_contract_v2(
      $1::uuid, 'Cliente Teste', '52998224725', '2026-09-21'::date,
      100000::bigint, 'Cliente próprio', 40::smallint, 'cash',
      $2::text, 'contrato.pdf', $3::jsonb, 'fixed_date', '2026-10-05'::date,
      null::text, 1, 100000::bigint, false, null::numeric, null::text, null::bigint, null::bigint
    )`, [contractId, filePath, schedule]);
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [contractId])).rows.length, 1);
    assert.equal((await db.query<{ contract_file_path: string }>(
      "select contract_file_path from public.contracts where id=$1", [contractId])).rows[0].contract_file_path, filePath);
    await assert.rejects(() => db.query(`select public.create_lawyer_contract_v2(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'Outro Cliente', '11144477735', '2026-09-21'::date,
      100000::bigint, 'Cliente próprio', 40::smallint, 'cash',
      null::text, null::text, $1::jsonb, 'condition', null::date,
      'Após liberação de valores.', 1, 100000::bigint,
      false, null::numeric, null::text, null::bigint, null::bigint
    )`, [schedule]));
  } finally { await db.close(); }
});
