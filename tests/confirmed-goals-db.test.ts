import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { GoalSummary } from "../src/lib/goals/model";

test("metas por data de contratação, acompanhamento da equipe e isolamento entre escritórios", async () => {
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
    await db.query("update profiles set is_office_admin=true where id=$1", [secretary]);
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const operator = () => db.exec("reset role; reset request.jwt.claim.sub");
    const client = randomUUID(), extraClient = randomUUID(), externalClient = randomUUID();
    await db.query("insert into clients(id,office_id,full_name) values($1,$2,'Cliente teste'),($3,$2,'Segundo contratante'),($4,$5,'Cliente externo')", [client,office,extraClient,externalClient,otherOffice]);
    const ids = Array.from({length:8},()=>randomUUID());
    // Três contratos de outubro, mesmo cadastrados em novembro e sem confirmação separada.
    for (const [i,id] of ids.entries()) await db.query(`insert into contracts(id,office_id,client_id,lawyer_id,origin,total_contract_value,contract_date,created_at)
      values($1,$2,$3,$4,'Cliente próprio',1000,$5,'2026-11-02T12:00:00Z')`,
      [id,i===7?otherOffice:office,i===7?externalClient:client,i===7?outsider:i===6?colleague:lawyer,
        i<3?['2026-10-05','2026-10-12','2026-10-28'][i]:i===3?'2026-09-30':i===4?'2026-10-15':i===5?'2026-10-18':'2026-10-20']);
    await db.query("update contracts set engagement_status='cancelled' where id=$1",[ids[4]]);
    await db.query("update contracts set deleted_at=now() where id=$1",[ids[5]]);
    await db.query("insert into contract_parties(contract_id,client_id,office_id,position) values($1,$2,$3,2)", [ids[0],extraClient,office]);
    const summary = async (scope="individual", period="2026-10") => (await db.query<{value:GoalSummary}>(
      "select contract_goal_summary($1,$2::date) as value", [scope,period+'-01'])).rows[0].value;
    const team = async () => (await db.query<{value:{members:{lawyer_id:string;full_name:string;count:number;target:number|null;previous_count:number}[]}}>(
      "select team_contract_goals('2026-10-01') as value")).rows[0].value;
    const version = async (id:string) => (await db.query<{value:string}>("select updated_at::text as value from contracts where id=$1", [id])).rows[0].value;
    const change = async (id:string,status:string,date:string|null) => db.query(
      "select set_contract_engagement($1,$2::timestamptz,$3,$4::date,'Conferência documentada')", [id,await version(id),status,date]);
    await asUser(lawyer);
    const value=await summary();
    assert.equal(value.count,3,"documentos de outubro entram mesmo sem confirmação e com cadastro posterior");
    assert.equal(value.pending_count,0);
    assert.equal(value.previous_count,1);assert.equal(value.comparison_available,true);
    assert.equal(value.history.length,6);
    await db.query("select save_my_contract_goal('2026-10-01',5)");
    assert.equal((await summary()).history.at(-1)?.target,5);
    await change(ids[0],"confirmed","2026-11-01");
    assert.equal((await summary()).count,3,"confirmar em novembro não muda o mês do documento");
    await change(ids[0],"unconfirmed",null);
    assert.equal((await summary()).count,3,"desfazer confirmação separada não remove cadastro das metas");
    await change(ids[0],"cancelled",null);assert.equal((await summary()).count,2);
    await change(ids[0],"unconfirmed",null);assert.equal((await summary()).count,3);
    await assert.rejects(team(),/não autorizado/);
    await assert.rejects(summary("office"),/não autorizado/);
    const ownStamp=await version(ids[0]);
    await asUser(colleague);
    assert.equal((await summary()).count,1);
    await assert.rejects(db.query("select set_contract_engagement($1,$2::timestamptz,'cancelled',null,'Tentativa indevida')",[ids[0],ownStamp]),/indisponível/);
    await db.query("select save_my_contract_goal('2026-10-01',2)");
    await asUser(secretary);
    await assert.rejects(team(),/não autorizado/);await assert.rejects(summary(),/não autorizado/);
    await db.query("select save_office_contract_goal('2026-10-01',10)");
    assert.equal((await summary("office")).count,4,"coletivo legado usa o mesmo critério sem duplicar contratantes");
    await asUser(manager);
    let members=(await team()).members;
    assert.equal(members.length,2);
    assert.equal(members.find(m=>m.lawyer_id===lawyer)?.count,3);
    assert.equal(members.find(m=>m.lawyer_id===lawyer)?.target,5);
    assert.equal(members.find(m=>m.lawyer_id===colleague)?.count,1);
    assert.equal(members.find(m=>m.lawyer_id===lawyer)?.previous_count,1);
    assert.equal(JSON.stringify(members).includes(client),false,"gestor recebe metas e totais, sem dados de clientes");
    await assert.rejects(db.query("select save_my_contract_goal('2026-10-01',10)"),/não autorizado/);
    await db.query("select correct_manager_field('contracts',$1,'contract_date','2026-09-15','Correção da data do documento')",[ids[1]]);
    assert.equal((await team()).members.find(m=>m.lawyer_id===lawyer)?.count,2,"corrigir data move o contrato para outro mês");
    await asUser(lawyer);assert.equal((await summary()).count,2);assert.equal((await summary('individual','2026-09')).count,2);
    await asUser(outsider);assert.equal((await summary()).count,1);await assert.rejects(team(),/não autorizado/);
    await operator();
    const externalManager=randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'manager-outside@example.com')",[externalManager]);
    await db.query("update profiles set role='manager',office_id=$2,active=true where id=$1",[externalManager,otherOffice]);
    await asUser(externalManager);
    const externalTeam=(await team()).members;
    assert.equal(externalTeam.length,1);assert.equal(externalTeam[0].lawyer_id,outsider);
    assert.equal(externalTeam[0].count,1);
    await operator();
    // A capacidade extra de admin não dá acompanhamento da equipe a uma advogada.
    await db.query("update profiles set is_office_admin=true where id=$1",[lawyer]);
    await asUser(lawyer);await assert.rejects(team(),/não autorizado/);
    await operator();
    await db.exec(await readFile(new URL("20261103000300_document_date_goals.sql",migrations),"utf8"));
    assert.equal((await db.query("select * from lawyer_monthly_goals")).rows.length,2,"migration reaplicável preserva metas");
    await db.query("update profiles set active=false where id=$1",[colleague]);
    await asUser(manager);members=(await team()).members;assert.equal(members.length,2,"inativas com histórico continuam no período");
    await operator();await db.query("update profiles set active=false where id=$1",[manager]);
    await asUser(manager);await assert.rejects(team(),/não autorizado/);
    await operator();await db.query("update profiles set active=false where id=$1",[lawyer]);
    await asUser(lawyer);await assert.rejects(summary(),/não autorizado/);
  } finally { await db.close(); }
});
