import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { GoalSummary } from "../src/lib/goals/model";

test("confirmações reais, metas coletivas, auditoria e isolamento entre escritórios", async () => {
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
    // Secretary + admin has collective goal powers, never a lawyer's personal attribution.
    await db.query("update profiles set is_office_admin=true where id=$1", [secretary]);
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    const operator = () => db.exec("reset role; reset request.jwt.claim.sub");
    const today = (await db.query<{day:string}>("select to_char(current_timestamp at time zone 'America/Sao_Paulo','YYYY-MM-DD') as day")).rows[0].day;
    const month = today.slice(0,7);
    const previous = (await db.query<{month:string}>("select to_char($1::date-interval '1 month','YYYY-MM') as month", [month+'-01'])).rows[0].month;
    const client = randomUUID(), extraClient = randomUUID();
    await db.query("insert into clients(id,office_id,full_name) values($1,$2,'Cliente teste'),($3,$2,'Segundo contratante')", [client,office,extraClient]);
    const ids = [randomUUID(),randomUUID(),randomUUID(),randomUUID()];
    for (const [i,id] of ids.entries()) await db.query(`insert into contracts(id,office_id,client_id,lawyer_id,origin,total_contract_value,contract_date)
      values($1,$2,$3,$4,'Cliente próprio',1000,$5)`, [id,office,client,i===2?colleague:lawyer,today]);
    await db.query("insert into contract_parties(contract_id,client_id,office_id,position) values($1,$2,$3,2)", [ids[0],extraClient,office]);
    const summary = async (scope="individual", period=month) => (await db.query<{value:GoalSummary}>(
      "select contract_goal_summary($1,$2::date) as value", [scope,period+'-01'])).rows[0].value;
    const version = async (id:string) => (await db.query<{value:string}>("select updated_at::text as value from contracts where id=$1", [id])).rows[0].value;
    const change = (id:string,stamp:string,status:string,date:string|null) => db.query(
      "select set_contract_engagement($1,$2::timestamptz,$3,$4::date,'Conferência documentada')", [id,stamp,status,date]);
    await asUser(lawyer);
    assert.equal((await summary()).count,0,"data do documento não confirma um contrato");
    assert.equal((await summary()).pending_count,3);
    assert.equal((await summary()).comparison_available,false);
    await db.query("select save_my_contract_goal($1,4)", [month+'-01']);
    const stamp=await version(ids[0]);
    await change(ids[0],stamp,"confirmed",today);
    assert.equal((await summary()).count,1,"dois contratantes contam uma única vez");
    await assert.rejects(change(ids[0],stamp,"cancelled",null), /contrato mudou/);
    await change(ids[1],await version(ids[1]),"confirmed",previous+'-01');
    let value=await summary();
    assert.equal(value.count,1); assert.equal(value.previous_count,1); assert.equal(value.comparison_available,true);
    assert.equal(value.history.length,6); assert.equal(value.history.at(-1)?.target,4);
    assert.equal((await summary("individual",previous)).count,1,"fechamento efetivo difere da criação e do documento");
    await assert.rejects(change(ids[3],await version(ids[3]),"confirmed","2099-01-01"), /sem data futura/);
    await assert.rejects(db.query("select set_contract_engagement($1,$2,'confirmed',$3,'x')", [ids[3],await version(ids[3]),today]), /motivo/);
    await assert.rejects(db.query("update contracts set engagement_status='confirmed',closed_on=$2 where id=$1", [ids[3],today]), /permission denied|fluxo auditado/);
    await assert.rejects(db.query("select save_my_contract_goal('2099-01-01',10)"), /quantidade/);
    await asUser(colleague);
    await assert.rejects(change(ids[0],stamp,"cancelled",null), /indisponível/);
    assert.equal((await summary()).count,0);
    await change(ids[2],await version(ids[2]),"confirmed",today);
    assert.equal((await summary()).count,1);
    await assert.rejects(summary("office"), /não autorizado/);
    await asUser(secretary);
    await db.query("select save_office_contract_goal($1,10)", [month+'-01']);
    await db.query("select save_office_contract_goal($1,12)", [month+'-01']);
    value=await summary("office"); assert.equal(value.count,2); assert.equal(value.history.at(-1)?.target,12);
    assert.equal((await db.query("select * from office_monthly_goals")).rows.length,1);
    assert.equal(JSON.stringify(value).includes(client),false,"RPC coletiva só retorna agregados");
    await assert.rejects(summary(), /não autorizado/);
    await assert.rejects(change(ids[0],await version(ids[0]),"cancelled",null), /não autorizado/);
    await assert.rejects(db.exec("update office_monthly_goals set target_contract_count=99"), /permission denied/);
    await asUser(manager);
    assert.equal((await summary("office")).count,2);
    await assert.rejects(db.query("select save_office_contract_goal($1,5)",[month+'-01']), /não autorizado/);
    await change(ids[0],await version(ids[0]),"cancelled",null);
    assert.equal((await summary("office")).count,1);
    await asUser(lawyer);
    assert.equal((await summary()).count,0);
    assert.equal((await db.query("select * from notifications where related_record_id=$1 and type='manager_correction'",[ids[0]])).rows.length,1);
    assert.equal((await db.query("select * from audit_logs where record_id=$1 and field_name='engagement_confirmation'",[ids[0]])).rows.length,2);
    await change(ids[0],await version(ids[0]),"confirmed",today);
    await change(ids[0],await version(ids[0]),"unconfirmed",null);
    assert.equal((await summary()).count,0,"desfazer confirmação remove a contagem");
    await asUser(outsider);
    assert.equal((await summary()).count,0); assert.equal((await summary()).pending_count,0);
    assert.equal((await db.query("select * from office_monthly_goals")).rows.length,0);
    await assert.rejects(change(ids[0],stamp,"confirmed",today), /indisponível/);
    await operator();
    await db.query("update profiles set is_office_admin=false where id=$1",[secretary]);
    await asUser(secretary); await assert.rejects(summary("office"), /não autorizado/);
    await operator();
    await db.query("update contracts set deleted_at=now() where id=$1",[ids[2]]);
    await asUser(manager); assert.equal((await summary("office")).count,0,"exclusão retira contrato da meta");
    await operator();
    await db.exec(await readFile(new URL("20261028000200_confirmed_contract_goals.sql",migrations),"utf8"));
    assert.equal((await db.query("select * from office_monthly_goals")).rows.length,1,"migration reaplicável preserva metas");
    await asUser(lawyer); assert.equal((await summary()).count,0,"reaplicar não confirma contratos legados");
    await operator(); await db.query("update profiles set active=false where id=$1",[lawyer]);
    await asUser(lawyer); await assert.rejects(summary(), /não autorizado/);
  } finally { await db.close(); }
});
