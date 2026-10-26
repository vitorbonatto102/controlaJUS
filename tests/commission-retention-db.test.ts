import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { blankContractForm, type ContractFormValues } from "../src/lib/contracts/registration";
import { prepareContractEdit } from "../src/lib/contracts/editing";

test("retenções são atômicas, respeitam o limite e preservam RLS, estornos e fechamentos", async () => {
  const db = new PGlite();
  const lawyer = randomUUID(), secretary = randomUUID(), manager = randomUUID(), colleague = randomUUID();
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
    for (const file of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    const office = (await db.query<{ id: string }>("select id from public.offices where slug='principal'")).rows[0].id;
    for (const [id, role] of [[lawyer, "lawyer"], [secretary, "secretary"], [manager, "manager"], [colleague, "lawyer"]]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.com`]);
      await db.query("update public.profiles set active=true,office_id=$2,role=$3,full_name='Usuário Teste' where id=$1", [id, office, role]);
    }
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const create = async (overrides: Partial<ContractFormValues> = {}) => {
      await asUser(lawyer);
      const id = randomUUID();
      const values = { ...blankContractForm, clientName: "Cliente Teste", cpf: "52998224725", serviceName: "Ação revisional",
        contractDate: "01/01/2001", total: "10.000,00", method: "installments" as const, count: "10", installmentValue: "1.000,00",
        paymentStartType: "fixed_date" as const, firstDue: "10/01/2001", origin: "Cliente próprio", percentage: "5",
        commissionMode: "upfront" as const, ...overrides };
      const prepared = prepareContractEdit(values, false);
      await db.query("select public.create_lawyer_contract_v4($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",
        [id, JSON.stringify([{ fullName: values.clientName, cpf: values.cpf }]), JSON.stringify(prepared.changes), JSON.stringify(prepared.schedule)]);
      const installments = (await db.query<{ id: string }>("select id from public.installments where contract_id=$1 order by installment_number", [id])).rows;
      return { id, installments, values };
    };
    const pay = async (installment: string, date: string, amount: number) => {
      await asUser(secretary);
      return (await db.query<{ id: string }>("insert into public.payments(installment_id,payment_date,amount_paid) values($1,$2,$3) returning id",
        [installment, date, amount])).rows[0].id;
    };
    const amounts = async (id: string) => {
      await asUser(lawyer);
      return (await db.query<{ commission_amount: string }>(`select cm.commission_amount from public.commissions cm
        join public.payments p on p.id=cm.payment_id join public.installments i on i.id=p.installment_id
        where i.contract_id=$1 and p.voided_at is null order by p.payment_date,p.created_at,p.id`, [id])).rows.map((row) => Number(row.commission_amount));
    };
    const editable = await create();
    const edit = async (values: ContractFormValues) => {
      await asUser(lawyer);
      const version = (await db.query<{ updated_at: string }>("select updated_at::text from public.contracts where id=$1", [editable.id])).rows[0].updated_at;
      const prepared = prepareContractEdit(values, false);
      await db.query("select public.edit_lawyer_contract_v2($1::uuid,$2::timestamptz,$3::jsonb,$4::jsonb,'Forma revisada antes de qualquer pagamento')",
        [editable.id, version, JSON.stringify(prepared.changes), JSON.stringify(prepared.schedule)]);
    };
    await edit({ ...editable.values, commissionMode: "proportional" });
    assert.equal((await db.query<{ commission_mode: string }>("select commission_mode from public.contract_financial_terms where contract_id=$1", [editable.id])).rows[0].commission_mode, "proportional");
    await edit({ ...editable.values, method: "success_only", total: "", successFeePercentage: "30", commissionLimit: "900,00" });
    assert.equal((await db.query("select id from public.installments where contract_id=$1", [editable.id])).rows.length, 0);
    assert.equal(Number((await db.query<{ commission_upfront_limit: string }>("select commission_upfront_limit from public.contract_financial_terms where contract_id=$1", [editable.id])).rows[0].commission_upfront_limit), 900);
    const initial = await create();
    await pay(initial.installments[0].id, "2001-01-10", 1000);
    await pay(initial.installments[1].id, "2001-02-10", 1080);
    assert.deepEqual(await amounts(initial.id), [500, 0], "5% do contrato é quitado na primeira parcela");
    const proportional = await create({ commissionMode: "proportional", percentage: "40" });
    await pay(proportional.installments[0].id, "2001-01-10", 1080);
    assert.deepEqual(await amounts(proportional.id), [432], "modelo proporcional mantém juros na base efetivamente recebida");
    const partial = await create({ percentage: "25" });
    const first = await pay(partial.installments[0].id, "2001-01-10", 1000);
    await pay(partial.installments[1].id, "2001-02-10", 1000);
    await pay(partial.installments[2].id, "2001-03-10", 1000);
    await pay(partial.installments[3].id, "2001-04-10", 1000);
    assert.deepEqual(await amounts(partial.id), [1000, 1000, 500, 0]);
    await asUser(secretary);
    await db.query("select public.revise_secretary_payment($1::uuid,'Pagamento registrado por engano',null::bigint,null::date)", [first]);
    assert.deepEqual(await amounts(partial.id), [1000, 1000, 500], "estorno libera retenção nos próximos recebimentos");
    await asUser(manager);
    await db.query("select public.correct_manager_field('contract_financial_terms',$1::uuid,'commission_percentage','5','Percentual corrigido pelo gestor')", [partial.id]);
    assert.deepEqual(await amounts(partial.id), [500, 0, 0]);
    await asUser(manager);
    await db.query("select public.correct_manager_field('contracts',$1::uuid,'total_contract_value','20000','Valor corrigido pelo gestor')", [partial.id]);
    assert.deepEqual(await amounts(partial.id), [1000, 0, 0]);

    const future = await create({ method: "success_only", total: "", successFeePercentage: "30", commissionLimit: "750,00" });
    assert.equal(future.installments.length, 0);
    assert.equal(Number((await db.query<{ commission_upfront_limit: string }>(
      "select commission_upfront_limit from public.contract_financial_terms where contract_id=$1", [future.id])).rows[0].commission_upfront_limit), 750);
    await assert.rejects(db.query("select public.correct_commission_retention($1::uuid,'proportional',null::numeric,'Tentativa sem permissão de gestor')", [future.id]), /não autorizado/);
    // O limite manual não contorna a regra existente de aguardar o êxito.
    await db.exec("reset role");
    await assert.rejects(db.query(`insert into public.installments
      (contract_id,installment_number,regular_number,due_date,contractual_amount)
      values($1,1,1,'2001-01-10',1000)`, [future.id]), /apenas no êxito/);
    await asUser(manager);
    await db.query("select public.correct_commission_retention($1::uuid,'upfront',650::numeric,'Limite da participação corrigido pelo gestor')", [future.id]);
    await asUser(lawyer);
    assert.equal(Number((await db.query<{ commission_upfront_limit: string }>(
      "select commission_upfront_limit from public.contract_financial_terms where contract_id=$1", [future.id])).rows[0].commission_upfront_limit), 650);
    await asUser(secretary);
    assert.equal((await db.query("select commission_mode,commission_upfront_limit from public.contract_financial_terms")).rows.length, 0);
    assert.equal((await db.query("select commission_amount from public.commissions")).rows.length, 0);
    await asUser(colleague);
    assert.equal((await db.query("select commission_mode from public.contract_financial_terms where contract_id=$1", [initial.id])).rows.length, 0);

    const closed = await create({ percentage: "10" });
    const february = await pay(closed.installments[1].id, "2001-02-10", 1000);
    await asUser(manager);
    await db.query("select public.confirm_monthly_closing($1::uuid,2::smallint,2001::smallint)", [lawyer]);
    const closing = (await db.query<{ id: string; commission_amount: string }>(
      "select id,commission_amount from public.monthly_closings where lawyer_id=$1 and reference_month=2 and reference_year=2001", [lawyer])).rows[0];
    await assert.rejects(pay(closed.installments[0].id, "2001-01-10", 500), /período já fechado/);
    await asUser(manager);
    const january = (await db.query<{ id: string }>("select public.manager_record_payment($1::uuid,'2001-01-10'::date,50000::bigint,null,'Recebimento anterior informado depois') as id",
      [closed.installments[0].id])).rows[0].id;
    assert.deepEqual(await amounts(closed.id), [500, 500]);
    await asUser(manager);
    assert.equal(Number((await db.query<{ adjustment_amount: string }>("select adjustment_amount from public.monthly_closings where id=$1", [closing.id])).rows[0].adjustment_amount), -500);
    assert.equal(Number((await db.query<{ commission_amount: string }>("select commission_amount from public.monthly_closing_items where closing_id=$1 and payment_id=$2", [closing.id, february])).rows[0].commission_amount), 1000);
    await db.query("select public.revise_manager_payment($1::uuid,'Correção do valor do primeiro recebimento',20000::bigint,'2001-01-10'::date)", [january]);
    assert.deepEqual(await amounts(closed.id), [200, 800]);
    await asUser(manager);
    assert.equal(Number((await db.query<{ adjustment_amount: string }>("select adjustment_amount from public.monthly_closings where id=$1", [closing.id])).rows[0].adjustment_amount), -200);
    await db.query("select public.correct_commission_retention($1::uuid,'proportional',null::numeric,'Forma de retenção corrigida pelo gestor')", [closed.id]);
    assert.deepEqual(await amounts(closed.id), [20, 100]);
    await asUser(manager);
    assert.equal(Number((await db.query<{ adjustment_amount: string }>("select adjustment_amount from public.monthly_closings where id=$1", [closing.id])).rows[0].adjustment_amount), -900);
    await asUser(lawyer);
    const version = (await db.query<{ updated_at: string }>("select updated_at::text from public.contracts where id=$1", [closed.id])).rows[0].updated_at;
    const changes = prepareContractEdit({ ...closed.values, commissionMode: "proportional" }, false);
    await assert.rejects(db.query("select public.edit_lawyer_contract_v2($1::uuid,$2::timestamptz,$3::jsonb,$4::jsonb,'Tentativa de trocar retenção após pagamento')",
      [closed.id, version, JSON.stringify(changes.changes), JSON.stringify(changes.schedule)]), /histórico de pagamentos/);
    const before = await amounts(closed.id);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec(await readFile(new URL("20261026000100_commission_retention.sql", migrations), "utf8"));
    assert.deepEqual(await amounts(closed.id), before, "reaplicar a migration não recalcula pagamentos existentes");
  } finally { await db.close(); }
});
