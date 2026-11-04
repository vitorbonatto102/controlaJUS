import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {test} from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {blankContractForm,prepareContract,type ContractFormValues} from "../src/lib/contracts/registration";
import {contractToForm,parseEditValues,prepareContractEdit} from "../src/lib/contracts/editing";
import type {ContractRecord} from "../src/lib/contracts/view";

const values:ContractFormValues={...blankContractForm,clientName:"Cliente Teste",cpf:"52998224725",serviceName:"Ação revisional",
  contractDate:"20/01/2026",total:"5.900,00",method:"installments",count:"6",installmentValue:"150,00",
  installmentGroups:[{count:"20",amount:"250,00"}],paymentStartType:"fixed_date",firstDue:"31/01/2026",
  origin:"Cliente próprio",percentage:"5",commissionMode:"proportional"};

test("grupos preservam quantidades, centavos, entrada e datas ancoradas no primeiro vencimento",()=>{
  const preview=prepareContract(values);
  assert.equal(preview.installmentCount,26);assert.equal(preview.sumCents,590000);assert.equal(preview.differenceCents,0);
  assert.equal(preview.rows.length,26);assert.equal(preview.rows[5].amount_cents,15000);assert.equal(preview.rows[6].amount_cents,25000);
  assert.equal(preview.rows[1].due_date,"2026-02-28");assert.equal(preview.rows[6].due_date,"2026-07-31");assert.equal(preview.rows[25].due_date,"2028-02-29");
  const entry=prepareContract({...values,total:"6.000,00",hasEntry:true,entryValue:"100,00",entryDue:"20/01/2026"});
  assert.equal(entry.rows.length,27);assert.equal(entry.rows[0].kind,"down_payment");assert.equal(entry.rows[7].regular_number,7);assert.equal(entry.differenceCents,0);
  const cents=prepareContract({...values,total:"5.899,99",lastInstallmentValue:"249,99"});assert.equal(cents.rows[25].amount_cents,24999);assert.equal(cents.differenceCents,0);
  assert.throws(()=>prepareContract({...values,installmentGroups:[{count:"120",amount:"1,00"}]}),/quantidade|120/);
  assert.throws(()=>prepareContract({...values,installmentGroups:[{count:"2.5",amount:"1,00"}]}),/quantidade/);
  assert.throws(()=>prepareContract({...values,installmentGroups:[{count:"20",amount:"0,00"}]}),/quantidade|valor/);
  assert.throws(()=>prepareContractEdit({...values,total:"6.000,00"},false),/total do cronograma/);
  assert.throws(()=>parseEditValues({...values,installmentGroups:[{count:20,amount:"250,00"}]}),/grupos/);
});

test("contrato condicionado conserva os grupos e os recupera na edição sem inventar vencimentos",()=>{
  const input={...values,paymentStartType:"condition" as const,firstDue:"",paymentStartCondition:"Após a liberação dos valores"};
  const prepared=prepareContractEdit(input,false),preview=prepareContract(input);
  assert.deepEqual(preview.rows,[]);assert.equal(preview.sumCents,590000);assert.equal(preview.installmentCount,26);
  const contract:ContractRecord={id:randomUUID(),client_id:randomUUID(),client_name:values.clientName,client_cpf:values.cpf,
    origin:values.origin,service_name:values.serviceName,contract_date:"2026-01-20",total_contract_value:5900,payment_method:"installments",
    payment_start_type:"condition",payment_start_condition:input.paymentStartCondition,installment_count:26,installment_amount:150,
    installment_groups:preview.installmentGroups,commission_percentage:5,contract_file_path:null,contract_file_name:null,installments:[]};
  const form=contractToForm(contract);assert.equal(form.count,"6");assert.equal(form.installmentGroups[0].count,"20");
  assert.deepEqual(prepareContractEdit(form,false),prepared);
});

test("banco valida o cronograma heterogêneo, persiste grupos, audita edições e protege histórico e escritórios",async()=>{
  const db=new PGlite(),lawyer=randomUUID(),peer=randomUUID(),secretary=randomUUID();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text not null,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text not null references storage.buckets(id),name text not null,owner_id text,primary key(bucket_id,name));
      create function storage.filename(path text) returns text language sql immutable as $$select reverse(split_part(reverse(path),'/',1))$$;
      create function storage.foldername(path text) returns text[] language sql immutable as $$select string_to_array(regexp_replace(path,'/[^/]+$',''),'/')$$;
      alter table storage.objects enable row level security;grant usage on schema public,auth,storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
    const migrations=new URL("../supabase/migrations/",import.meta.url);
    for(const file of (await readdir(migrations)).filter(f=>f.endsWith(".sql")).sort())await db.exec(await readFile(new URL(file,migrations),"utf8"));
    const office=(await db.query<{id:string}>("select id from offices where slug='principal'")).rows[0].id,otherOffice=randomUUID();
    await db.query("insert into offices(id,name,slug) values($1,'Outro escritório','outro-grupos')",[otherOffice]);
    for(const [id,role,off] of [[lawyer,"lawyer",office],[peer,"lawyer",otherOffice],[secretary,"secretary",office]]){
      await db.query("insert into auth.users(id,email) values($1,$2)",[id,`${id}@example.com`]);
      await db.query("update profiles set active=true,role=$2,office_id=$3 where id=$1",[id,role,off]);
    }
    const asUser=async(id:string)=>{await db.exec("set role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
    const create=async(id:string,input=values,schedule?:unknown,changes?:unknown)=>{const prepared=prepareContractEdit(input,false);return db.query("select create_lawyer_contract_v8($1,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",
      [id,JSON.stringify([{fullName:input.clientName,cpf:input.cpf}]),JSON.stringify(changes??prepared.changes),JSON.stringify(schedule??prepared.schedule)]);};
    const version=async(id:string)=>(await db.query<{updated_at:string}>("select updated_at::text from contracts where id=$1",[id])).rows[0].updated_at;
    const edit=async(id:string,input:ContractFormValues)=>{const prepared=prepareContractEdit(input,false);return db.query("select edit_lawyer_contract_v6($1,$2,$3::jsonb,$4::jsonb,'Revisão dos grupos de parcelas')",[id,await version(id),JSON.stringify(prepared.changes),JSON.stringify(prepared.schedule)]);};
    await asUser(lawyer);const id=randomUUID();await create(id);
    const stored=(await db.query<{installment_count:number;installment_groups:unknown}>("select installment_count,installment_groups from contracts where id=$1",[id])).rows[0];
    assert.equal(stored.installment_count,26);assert.deepEqual(stored.installment_groups,[{count:6,amount_cents:15000},{count:20,amount_cents:25000}]);
    const rows=(await db.query<{id:string;contractual_amount:string;due_date:string}>("select id,contractual_amount,due_date::text from installments where contract_id=$1 order by installment_number",[id])).rows;
    assert.equal(rows.length,26);assert.equal(Number(rows[5].contractual_amount),150);assert.equal(Number(rows[6].contractual_amount),250);assert.equal(rows[25].due_date,"2028-02-29");
    const tampered=prepareContract(values).rows.map((row,index)=>({...row,amount_cents:row.amount_cents+(index===0?100:index===1?-100:0)}));
    await assert.rejects(create(randomUUID(),values,tampered),/Valor ou ordem/);
    const changedDate=prepareContract(values).rows.map((row,index)=>({...row,due_date:index===6?"2026-08-01":row.due_date}));
    await assert.rejects(create(randomUUID(),values,changedDate),/Vencimentos mensais/);
    const alteredGroups={...prepareContractEdit(values,false).changes,installment_groups:[{count:6,amount_cents:15000},{count:20,amount_cents:25000.5}]};
    await assert.rejects(create(randomUUID(),values,undefined,alteredGroups),/Grupo de parcelas/);
    await edit(id,{...values,count:"5",installmentValue:"180,00"});
    assert.equal((await db.query("select id from audit_logs where record_id=$1 and field_name='installment_groups'",[id])).rows.length,1);
    const conditioned=randomUUID();await create(conditioned,{...values,paymentStartType:"condition",firstDue:"",paymentStartCondition:"Após a liberação dos valores"});
    assert.equal((await db.query("select id from installments where contract_id=$1",[conditioned])).rows.length,0);
    await edit(conditioned,values);assert.equal((await db.query("select id from installments where contract_id=$1",[conditioned])).rows.length,26);
    await asUser(secretary);await assert.rejects(create(randomUUID()),/não autorizado/);
    await db.query("insert into payments(installment_id,payment_date,amount_paid) select id,'2026-01-31',180 from installments where contract_id=$1 and installment_number=1",[id]);
    await asUser(lawyer);await assert.rejects(edit(id,values),/histórico de pagamentos/);
    await asUser(peer);assert.equal((await db.query("select id from contracts where id=$1",[id])).rows.length,0);
    await assert.rejects(db.query("select edit_lawyer_contract_v6($1,now(),'{}'::jsonb,'[]'::jsonb,'Tentativa de outra conta')",[id]),/indisponível/);
    await db.exec("reset role;reset request.jwt.claim.sub");
    await db.exec(await readFile(new URL("20261104000700_installment_groups.sql",migrations),"utf8"));
    assert.equal((await db.query("select id from installments where contract_id=$1",[id])).rows.length,25,"reaplicar não altera o cronograma existente");
  }finally{await db.close();}
});
