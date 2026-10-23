import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { blankContractForm } from "../src/lib/contracts/registration";
import { prepareContractEdit } from "../src/lib/contracts/editing";

test("avisos operacionais são atômicos, sem duplicar edições e isolados por advogada e escritório", async () => {
  const db = new PGlite();
  const lawyer = randomUUID(), colleague = randomUUID(), outsideLawyer = randomUUID();
  const secretary = randomUUID(), outsideSecretary = randomUUID(), manager = randomUUID(), otherOffice = randomUUID();
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
    const notificationMigration = await readFile(new URL("20261022000600_secretary_notifications.sql", migrations), "utf8");
    await db.exec(notificationMigration);
    const office = (await db.query<{ id: string }>("select id from public.offices where slug='principal'")).rows[0].id;
    await db.query("insert into public.offices(id,name,slug) values($1,'Outro escritório','outro')", [otherOffice]);
    for (const [id, officeId, role, name] of [
      [lawyer, office, "lawyer", "Advogada Teste"], [colleague, office, "lawyer", "Colega Teste"],
      [outsideLawyer, otherOffice, "lawyer", "Advogada de Outro Escritório"], [secretary, office, "secretary", "Secretária Teste"],
      [outsideSecretary, otherOffice, "secretary", "Outra Secretária"], [manager, office, "manager", "Gestor Teste"],
    ]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.com`]);
      await db.query("update public.profiles set active=true,office_id=$2,role=$3,full_name=$4 where id=$1", [id, officeId, role, name]);
    }
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const prepared = prepareContractEdit({ ...blankContractForm, clientName: "Cliente Teste", cpf: "52998224725",
      serviceName: "Ação revisional", contractDate: "22/10/2026", total: "1.000,00", method: "cash", count: "1",
      installmentValue: "1.000,00", paymentStartType: "fixed_date", firstDue: "10/12/2026", origin: "Cliente próprio", percentage: "40" }, false);
    await asUser(lawyer);
    const contract = randomUUID();
    await db.query("select public.create_lawyer_contract_v3($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",
      [contract, JSON.stringify([{ fullName: "Cliente Teste", cpf: "52998224725" }]), JSON.stringify(prepared.changes), JSON.stringify(prepared.schedule)]);
    const installment = (await db.query<{ id: string }>("select id from public.installments where contract_id=$1", [contract])).rows[0].id;
    const client = (await db.query<{ client_id: string }>("select client_id from public.contracts where id=$1", [contract])).rows[0].client_id;
    type Notice = { id: string; type: string; message: string; related_record_id: string; read_at: string | null };
    const notices = async () => (await db.query<Notice>("select id,type,message,related_record_id,read_at from public.notifications order by created_at,id")).rows;
    await asUser(secretary);
    const payment = (await db.query<{ id: string }>("insert into public.payments(installment_id,payment_date,amount_paid) values($1,'2026-12-10',1080) returning id", [installment])).rows[0].id;
    assert.equal((await notices()).length, 0);
    await asUser(lawyer);
    let received = await notices();
    assert.equal(received.length, 1);
    assert.equal(received[0].type, "secretary_payment_recorded");
    assert.equal(received[0].related_record_id, payment);
    for (const text of ["Secretária Teste", "Cliente Teste", "Ação revisional", "R$ 1.080,00", "10/12/2026"])
      assert.ok(received[0].message.includes(text), text);
    assert.equal(received[0].read_at, null);
    for (const actor of [colleague, outsideLawyer, outsideSecretary]) {
      await asUser(actor); assert.equal((await notices()).length, 0);
    }
    await assert.rejects(db.query("select public.revise_secretary_payment($1::uuid,'Tentativa de outro escritório',null::bigint,null::date)", [payment]), /indisponível/);
    await asUser(secretary);
    const replacement = (await db.query<{ id: string }>("select public.revise_secretary_payment($1::uuid,'Correção do valor recebido',110000::bigint,'2026-12-11'::date) as id", [payment])).rows[0].id;
    await asUser(lawyer);
    received = await notices();
    assert.equal(received.length, 2, "edição deve gerar apenas um aviso adicional");
    const update = received.find((item) => item.type === "secretary_payment_updated")!;
    assert.equal(update.related_record_id, payment);
    assert.match(update.message, /1\.080,00.*1\.100,00/);
    assert.match(update.message, /Correção do valor recebido/);
    await asUser(secretary);
    await db.exec("begin");
    await db.query("insert into public.payments(installment_id,payment_date,amount_paid) values($1,'2026-12-10',100)", [installment]);
    await db.query("insert into public.collection_notes(client_id,contract_id,note_type,content) values($1,$2,'collection','Registro que será revertido')", [client, contract]);
    await db.exec("rollback");
    await asUser(lawyer); assert.equal((await notices()).length, 2);
    await asUser(secretary);
    const note = (await db.query<{ id: string }>("insert into public.collection_notes(client_id,contract_id,note_type,content) values($1,$2,'collection','Cliente contatado sobre a parcela') returning id", [client, contract])).rows[0].id;
    await db.query("insert into public.collection_notes(client_id,note_type,content) values($1,'general','Nota geral operacional sem contrato')", [client]);
    await db.query("select public.revise_secretary_payment($1::uuid,'Lançamento excluído por duplicidade',null::bigint,null::date)", [replacement]);
    await asUser(lawyer);
    received = await notices();
    assert.equal(received.length, 4);
    assert.ok(received.some((item) => item.type === "secretary_collection_note" && item.related_record_id === note));
    assert.ok(received.some((item) => item.type === "secretary_payment_voided" && item.related_record_id === replacement && item.message.includes("duplicidade")));
    await assert.rejects(db.query("insert into public.notifications(user_id,type,title,message) values($1,'fake','Falso','Aviso falso')", [lawyer]), /permission denied/);
    await asUser(manager);
    await db.query("select public.correct_manager_field('contracts',$1::uuid,'origin','Tráfego HP','Correção de origem solicitada')", [contract]);
    await asUser(lawyer);
    received = await notices();
    assert.equal(received.filter((item) => item.type === "manager_correction").length, 1);
    assert.equal(received.length, 5);
    await db.query("update public.notifications set read_at=now() where id=$1", [received[0].id]);
    assert.ok((await notices()).find((item) => item.id === received[0].id)?.read_at);
    await asUser(secretary); assert.equal((await notices()).length, 0);
    await asUser(colleague); assert.equal((await notices()).length, 0);
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.exec(notificationMigration);
    await asUser(lawyer); assert.equal((await notices()).length, 5);
  } finally { await db.close(); }
});
