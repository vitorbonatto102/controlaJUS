import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

type Payload={rows:{row_id:string;contract_id:string;received_amount:number;balance:number;clients:{name:string}[]}[];commissions?:{payment_id:string;amount:number}[]};
test("relatórios aplicam RLS, filtros e snapshots sem expor comissões à secretaria",async()=>{
 const db=new PGlite();
 const lawyer=randomUUID(),colleague=randomUUID(),outsider=randomUUID(),secretary=randomUUID(),manager=randomUUID(),otherOffice=randomUUID();
 try{
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
    await db.query("update profiles set is_office_admin=true where id in($1,$2)",[lawyer,secretary]);
    const clientA=randomUUID(),clientB=randomUUID(),extra=randomUUID(),clientOut=randomUUID();
    for(const [id,off,name,cpf] of [[clientA,office,'Cliente A','52998224725'],[clientB,office,'Cliente B','39053344705'],[extra,office,'Cliente adicional','11144477735'],[clientOut,otherOffice,'Cliente externo','52998224725']])
      await db.query("insert into clients(id,office_id,full_name,cpf) values($1,$2,$3,$4)",[id,off,name,cpf]);
    const a=randomUUID(),b=randomUUID(),outside=randomUUID();
    for(const [id,off,client,owner] of [[a,office,clientA,lawyer],[b,office,clientB,colleague],[outside,otherOffice,clientOut,outsider]]){
      await db.query("insert into contracts(id,office_id,client_id,lawyer_id,origin,total_contract_value,contract_date,service_name) values($1,$2,$3,$4,'Cliente próprio',2000,'2001-01-01','Revisional contratual')",[id,off,client,owner]);
      await db.query("insert into contract_financial_terms(contract_id,commission_percentage) values($1,40)",[id]);
    }
    await db.query("insert into contract_parties(contract_id,client_id,office_id,position) values($1,$2,$3,2)",[a,extra,office]);
    const ia=randomUUID(),ia2=randomUUID(),ib=randomUUID(),io=randomUUID();
    for(const [id,contract,number,date] of [[ia,a,1,'2001-01-10'],[ia2,a,2,'2001-02-10'],[ib,b,1,'2001-01-10'],[io,outside,1,'2001-01-10']])
      await db.query("insert into installments(id,contract_id,installment_number,regular_number,kind,due_date,contractual_amount) values($1,$2,$3,$3,'regular',$4,1000)",[id,contract,number,date]);
    const asUser=async(id:string)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
    const report=async(kind='payments',owner:string|null=null,client='',cpf='',service='',status='all',from='2001-01-01',to='2001-02-28')=>(await db.query<{report:Payload}>(
      "select filtered_activity_report($1,$2::date,$3::date,$4::uuid,$5,$6,'',$7,$8) as report",[kind,from,to,owner,client,cpf,service,status])).rows[0].report;
    const outsideSecretary=randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'outside-secretary@example.com')",[outsideSecretary]);
    await db.query("update profiles set role='secretary',office_id=$2,active=true where id=$1",[outsideSecretary,otherOffice]);
    await asUser(outsideSecretary);
    await db.query("insert into payments(installment_id,payment_date,amount_paid) values($1,'2001-01-15',1000)",[io]);
    await asUser(secretary);
    const pa=(await db.query<{id:string}>("insert into payments(installment_id,payment_date,amount_paid) values($1,'2001-01-15',1080) returning id",[ia])).rows[0].id;
    await db.query("insert into payments(installment_id,payment_date,amount_paid) values($1,'2001-01-20',200)",[ib]);
    let data=await report();assert.equal(data.rows.length,2);assert.equal('commissions' in data,false,"nem a secretaria admin recebe dados de comissão");
    assert.equal((await report('payments',lawyer)).rows.length,1);
    data=await report('payments',null,'','11144477735');assert.equal(data.rows.length,1);assert.equal(data.rows[0].clients.length,2,"vários contratantes não duplicam pagamentos");
    assert.equal((await report('payments',null,'Cliente adicional')).rows.length,1);
    assert.equal((await report('payments',null,'%')).rows.length,0,"busca trata caracteres literalmente");
    assert.equal((await report('contracts')).rows.length,2);
    assert.equal((await report('installments',lawyer,'','','','overdue')).rows.length,1);
    assert.equal((await report('installments',lawyer,'','','','paid')).rows.length,1);
    await assert.rejects(report('payments',null,'','','','paid'),/filtros/);
    await asUser(lawyer);
    data=await report();assert.equal(data.rows.length,1);assert.equal(Number(data.commissions?.[0].amount),432);
    await assert.rejects(report('payments',colleague),/próprios dados/);
    await asUser(colleague);assert.equal((await report()).rows.length,1);
    await asUser(outsider);assert.equal((await report()).rows.length,1);assert.equal((await report()).rows[0].contract_id,outside);
    await asUser(manager);data=await report();assert.equal(data.rows.length,2);assert.equal(data.commissions?.length,2);
    await asUser(secretary);
    await db.query("insert into payments(installment_id,payment_date,amount_paid) values($1,'2099-01-15',1000)",[ia2]);
    assert.equal((await report('payments',lawyer,'','','','all','2099-01-01','2099-01-31')).rows.length,0,"pagamento futuro não vira recebido");
    assert.equal((await report('installments',lawyer,'','','','overdue')).rows.length,1);
    await asUser(manager);
    const closing=(await db.query<{id:string}>("select confirm_monthly_closing($1,1::smallint,2001::smallint) as id",[lawyer])).rows[0].id;
    const closed=async()=>(await db.query<{report:{items:{amount_received:number}[];closing:{office_amount_received:number;office_adjustment_amount:number};adjustments:{office_delta:number;commission_delta:number}[];transfers:unknown[]}}>("select closed_month_report($1) as report",[closing])).rows[0].report;
    let snapshot=await closed();assert.equal(Number(snapshot.items[0].amount_received),1080);
    await db.query("select revise_manager_payment($1,'Correção documentada do recebimento',100000::bigint,'2001-01-15'::date)",[pa]);
    await db.query("select register_commission_transfer($1,20000::bigint,'2001-02-01'::date,'Repasse parcial')",[closing]);
    snapshot=await closed();assert.equal(Number(snapshot.items[0].amount_received),1080,"composição original preservada após correção");
    assert.equal(Number(snapshot.closing.office_adjustment_amount),-80);assert.equal(snapshot.adjustments.reduce((sum,item)=>sum+Number(item.office_delta),0),-80);assert.equal(snapshot.adjustments.reduce((sum,item)=>sum+Number(item.commission_delta),0),-32);assert.equal(snapshot.transfers.length,1);
    const actual=await report();assert.equal(actual.rows.length,2);assert.equal(actual.rows.reduce((sum,row)=>sum+Number(row.received_amount),0),1200,"pagamento estornado é substituído sem duplicar recebimentos");
    await asUser(lawyer);assert.equal((await closed()).items.length,1);
    await asUser(colleague);await assert.rejects(closed(),/indisponível/);
    await asUser(secretary);await assert.rejects(closed(),/não autorizado/);
    await asUser(outsider);await assert.rejects(closed(),/indisponível/);
    await db.exec('reset role;reset request.jwt.claim.sub');
    await db.exec(await readFile(new URL('20261103000100_reports.sql',migrations),'utf8'));
    // Automação começa em outubro; relógio controlado só no banco proprietário de teste.
    await asUser(secretary);
    const octoberPayment=(await db.query<{id:string}>("insert into payments(installment_id,payment_date,amount_paid) values($1,'2026-10-20',500) returning id",[ia2])).rows[0].id;
    await db.exec('reset role;reset request.jwt.claim.sub');
    const run=async(time:string)=>(await db.query<{count:number}>("select private.run_automatic_closings($1::timestamptz) as count",[time])).rows[0].count;
    assert.equal(await run('2026-11-01T02:58:00Z'),0);
    assert.ok(await run('2026-11-01T02:59:00Z')>0);
    assert.equal(await run('2026-11-01T02:59:00Z'),0,'execução repetida não duplica');
    const auto=(await db.query<{id:string;automatic:boolean}>("select id,automatic from monthly_closings where lawyer_id=$1 and reference_year=2026 and reference_month=10",[lawyer])).rows[0];
    assert.equal(auto.automatic,true);
    await db.exec(await readFile(new URL('20261103000200_automatic_closings.sql',migrations),'utf8'));
    assert.equal(await run('2026-11-01T02:59:00Z'),0,'reaplicar migration também é seguro');
    assert.equal((await db.query("select id from monthly_closings where reference_year=2026 and reference_month<10")).rows.length,0);
    const correct=async(mode:string,payment:string|null,amount:number|null)=>(await db.query<{id:string}>("select correct_closed_values($1,$2,$3,$4,$5::bigint,$6::date,$7) as id",[auto.id,mode,payment,ia2,amount,mode==='void'?null:'2026-10-20','Conferência do valor efetivamente recebido'])).rows[0].id;
    await asUser(colleague);await assert.rejects(correct('replace',octoberPayment,60000),/indisponível/);
    await asUser(outsider);await assert.rejects(correct('add',null,10000),/não autorizado/);
    await asUser(secretary);await assert.rejects(correct('add',null,10000),/não autorizado/);
    await asUser(lawyer);
    await assert.rejects(db.query("select private.run_automatic_closings()"),/permission denied/);
    await assert.rejects(db.query("select private.revise_closed_payment($1,'Tentativa direta',60000::bigint,'2026-10-20'::date)",[octoberPayment]),/permission denied/);
    const replacement=await correct('replace',octoberPayment,60000);
    await asUser(manager);
    assert.ok((await db.query("select id from notifications where user_id=$1 and type='closing_correction'",[manager])).rows.length>0);
    await correct('add',null,10000);
    await asUser(lawyer);
    await correct('void',replacement,null);
    const final=(await db.query<{report:{items:{amount_received:number}[];closing:{office_adjustment_amount:number}}}>("select closed_month_report($1) as report",[auto.id])).rows[0].report;
    assert.equal(Number(final.items[0].amount_received),500,'snapshot original não muda');
    assert.equal(Number(final.closing.office_adjustment_amount),-400,'saldo final 100 recebido após correções');
    assert.ok((await db.query("select id from notifications where user_id=$1 and type='closing_correction'",[lawyer])).rows.length>0);
    await db.exec('reset role;reset request.jwt.claim.sub');
    await db.query("update profiles set active=false where id=$1",[lawyer]);
    await asUser(lawyer);await assert.rejects(report(),/não autorizado/);
 }finally{await db.close();}
});
