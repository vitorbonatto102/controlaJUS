import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { blankContractForm, type ContractFormValues } from "../src/lib/contracts/registration";
import { prepareContractEdit } from "../src/lib/contracts/editing";

test("reserva comercial, agenda, repasses parciais e isolamento financeiro", async () => {
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
        commissionMode: "upfront" as const, commercialRecipientName: overrides.origin === "Tráfego HP" ? "Marina Comercial" : "", ...overrides };
      const prepared = prepareContractEdit(values, false);
      await db.query("select public.create_lawyer_contract_v6($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",
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
    const calendar=(year:number,month:number,day:number,start:string|null=null)=>db.query<{day:string}>("select to_char(private.contract_payout_date($1,$2,$3,$4::date),'YYYY-MM-DD') as day",[year,month,day,start]);
    assert.equal((await calendar(2028,1,31)).rows[0].day,'2028-02-29');
    assert.equal((await calendar(2026,12,15)).rows[0].day,'2027-01-15');
    assert.equal((await calendar(2026,10,1,'2026-11-10')).rows[0].day,'2026-11-10');
    const traffic=await create({origin:"Tráfego HP",commissionMode:"upfront",commercialPercentage:"5",payoutDay:"15",count:"20",installmentValue:"500,00"});
    const preparedTraffic=prepareContractEdit(traffic.values,false);
    await assert.rejects(db.query("select create_lawyer_contract_v6($1,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",[
      randomUUID(),JSON.stringify([{fullName:traffic.values.clientName,cpf:traffic.values.cpf}]),
      JSON.stringify({...preparedTraffic.changes,commercial_recipient_name:null}),JSON.stringify(preparedTraffic.schedule)]),/beneficiário comercial/);
    assert.equal((await db.query<{name:string}>("select commercial_recipient_name as name from contract_financial_terms where contract_id=$1",[traffic.id])).rows[0].name,"Marina Comercial");
    const first=await pay(traffic.installments[0].id,"2001-01-10",500);
    await pay(traffic.installments[1].id,"2001-01-15",500);
    await pay(traffic.installments[2].id,"2001-01-20",1080);
    assert.deepEqual(await amounts(traffic.id),[250,250,0]);
    await asUser(manager);
    const commercial=(await db.query<{amount:string}>("select cc.amount from commercial_commissions cc join payments p on p.id=cc.payment_id join installments i on i.id=p.installment_id where i.contract_id=$1 order by p.payment_date,p.created_at,p.id",[traffic.id])).rows.map(r=>Number(r.amount));
    assert.deepEqual(commercial,[250,250,0]);
    const pennies=await create({origin:"Tráfego HP",commercialPercentage:"5",payoutDay:"15",total:"0,40",count:"4",installmentValue:"0,10"});
    for(let n=0;n<4;n++) await pay(pennies.installments[n].id,`2002-01-0${n+1}`,.01);
    assert.deepEqual(await amounts(pennies.id),[.01,0,.01,0],"arredondamento cumulativo preserva centavos da advogada");
    await asUser(manager);
    assert.equal(Number((await db.query<{total:string}>("select sum(cc.amount) as total from commercial_commissions cc join payments p on p.id=cc.payment_id join installments i on i.id=p.installment_id where i.contract_id=$1",[pennies.id])).rows[0].total),.02);
    assert.equal((await db.query("select p.id from payments p join commissions cm on cm.payment_id=p.id join commercial_commissions cc on cc.payment_id=p.id where cm.commission_amount+cc.amount>p.amount_paid")).rows.length,0);
    const normal=await create();await pay(normal.installments[0].id,"2001-01-10",500);
    const proportional=await create({origin:"Tráfego HP",commissionMode:"proportional",commercialPercentage:"5",payoutDay:"15"});
    const pp=await pay(proportional.installments[0].id,"2001-01-12",1080);
    assert.deepEqual(await amounts(proportional.id),[54]);
    await asUser(manager);
    const closing=(await db.query<{id:string}>("select confirm_monthly_closing($1,1::smallint,2001::smallint) as id",[lawyer])).rows[0].id;
    type Item={contract_id:string;recipient:string;recipient_name:string|null;amount:number;balance:number;paid:number;due_date:string};
    const agenda=async()=>(await db.query<{data:{items:Item[];unallocated_transfers:{id:string;amount:number}[];commercial_transfers?:{id:string;amount:number;reversed_at:string|null}[]}}>("select closing_payout_agenda($1) as data",[closing])).rows[0].data;
    let rows=(await agenda()).items;
    assert.equal(rows.find(r=>r.contract_id===traffic.id&&r.recipient==='lawyer')?.due_date,'2001-02-15');
    assert.equal(rows.find(r=>r.contract_id===normal.id&&r.recipient==='lawyer')?.due_date,'2001-02-01');
    assert.equal(Number(rows.find(r=>r.contract_id===traffic.id&&r.recipient==='commercial')?.amount),500);
    assert.equal(rows.find(r=>r.contract_id===traffic.id&&r.recipient==='commercial')?.recipient_name,'Marina Comercial');
    const today=(await db.query<{day:string}>("select to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD') as day")).rows[0].day;
    const transfer=async(contract:string,recipient:string,amount:number,existing:string|null=null)=>(await db.query<{id:string}>(
      "select register_scheduled_transfer($1,$2,$3,$4::bigint,$5::date,'Pagamento conferido pelo gestor',$6) as id",[closing,contract,recipient,amount,existing?null:today,existing])).rows[0].id;
    await assert.rejects(db.query("select register_commission_transfer($1,100::bigint,'2099-01-01','Tentativa de registrar previsão como pagamento')",[closing]),/data futura/);
    const t1=await transfer(traffic.id,'lawyer',20000);
    await transfer(traffic.id,'lawyer',30000);
    await assert.rejects(transfer(traffic.id,'lawyer',1),/saldo/);
    assert.equal(Number((await agenda()).items.find(r=>r.contract_id===traffic.id&&r.recipient==='lawyer')?.balance),0);
    const tc=await transfer(traffic.id,'commercial',10000);
    assert.match((await db.query<{notes:string}>("select notes from commercial_transfers where id=$1",[tc])).rows[0].notes,/Marina Comercial/);
    assert.equal(Number((await agenda()).items.find(r=>r.contract_id===traffic.id&&r.recipient==='commercial')?.balance),400);
    await db.query("select reverse_commercial_transfer($1,'Pagamento comercial estornado por conferência')",[tc]);
    assert.equal(Number((await agenda()).items.find(r=>r.contract_id===traffic.id&&r.recipient==='commercial')?.balance),500);
    const legacy=(await db.query<{id:string}>("select register_commission_transfer($1,2500::bigint,$2::date,'Repasse antigo sem identificação') as id",[closing,today])).rows[0].id;
    await assert.rejects(transfer(normal.id,'lawyer',10000),/Vincule primeiro/);
    await transfer(normal.id,'lawyer',2500,legacy);
    assert.equal((await agenda()).unallocated_transfers.length,0);
    assert.equal(Number((await agenda()).items.find(r=>r.contract_id===normal.id)?.paid),25);
    await db.query("select reverse_commission_transfer($1,'Correção de repasse conferida')",[t1]);
    assert.equal(Number((await agenda()).items.find(r=>r.contract_id===traffic.id&&r.recipient==='lawyer')?.balance),200);
    await db.query("select save_contract_payout_terms_v2($1,5,22,null,'Novo beneficiário e dia para próximos fechamentos','Outra pessoa comercial')",[traffic.id]);
    assert.equal((await agenda()).items.find(r=>r.contract_id===traffic.id)?.due_date,'2001-02-15','prazo do snapshot fechado não muda ao editar o contrato');
    assert.equal((await agenda()).items.find(r=>r.contract_id===traffic.id&&r.recipient==='commercial')?.recipient_name,'Marina Comercial','nome do fechamento preservado após revisão do contrato');
    assert.match((await db.query<{notes:string}>("select notes from commercial_transfers where id=$1",[tc])).rows[0].notes,/Marina Comercial/,'nome do pagamento original preservado');
    await db.query("select revise_payout_date($1,$2,'2001-02-20','Prazo revisto conforme acordo')",[closing,traffic.id]);
    assert.equal((await agenda()).items.find(r=>r.contract_id===traffic.id)?.due_date,'2001-02-20');
    await db.query("select revise_manager_payment($1,'Valor corrigido após fechamento',100000::bigint,'2001-01-12'::date)",[pp]);
    rows=(await agenda()).items;
    assert.equal(Number(rows.find(r=>r.contract_id===proportional.id&&r.recipient==='commercial')?.amount),50);
    assert.equal(Number(rows.find(r=>r.contract_id===proportional.id&&r.recipient==='lawyer')?.amount),50);
    const snapshot=(await db.query<{amount:string}>("select commercial_amount as amount from monthly_closing_items where closing_id=$1 and payment_id=$2",[closing,pp])).rows[0];
    assert.equal(Number(snapshot.amount),54,'snapshot comercial original preservado');
    await db.query("select save_contract_payout_terms_v2($1,10,22,null,'Percentual comercial personalizado pelo gestor','Outra pessoa comercial')",[traffic.id]);
    assert.equal(Number((await agenda()).items.find(r=>r.contract_id===traffic.id&&r.recipient==='commercial')?.amount),1000,'reserva personalizada gera ajuste no fechamento');
    assert.equal(Number((await db.query<{amount:string}>("select sum(commercial_amount) as amount from monthly_closing_items s join payments p on p.id=s.payment_id join installments i on i.id=p.installment_id where s.closing_id=$1 and i.contract_id=$2",[closing,traffic.id])).rows[0].amount),500,'composição original preservada');
    await assert.rejects(db.query("select save_contract_payout_terms_v2($1,10,1,null,'Tentativa de comercial em outra origem','Pessoa comercial')",[normal.id]),/Tráfego HP/);
    await asUser(lawyer);
    await assert.rejects(db.query("select create_lawyer_contract_v6($1,$2::jsonb,$3::jsonb,$4::jsonb,null,null)",[
      randomUUID(),JSON.stringify([{fullName:traffic.values.clientName,cpf:traffic.values.cpf}]),
      JSON.stringify({...preparedTraffic.changes,commission_percentage:60,commercial_percentage:60}),JSON.stringify(preparedTraffic.schedule)]),/100/);
    const editable=await create({origin:'Tráfego HP',percentage:'5',commercialPercentage:'60'});
    const edited=prepareContractEdit({...editable.values,percentage:'50',commercialPercentage:'50'},false);
    const version=(await db.query<{version:string}>("select updated_at::text as version from contracts where id=$1",[editable.id])).rows[0].version;
    await db.query("select edit_lawyer_contract_v4($1,$2::timestamptz,$3::jsonb,$4::jsonb,'Percentuais personalizados antes dos pagamentos')",[editable.id,version,JSON.stringify(edited.changes),JSON.stringify(edited.schedule)]);
    assert.deepEqual((await db.query("select commission_percentage,commercial_percentage from contract_financial_terms where contract_id=$1",[editable.id])).rows[0],{commission_percentage:'50.00',commercial_percentage:50});
    const unequal=await create({origin:'Tráfego HP',percentage:'10',commercialPercentage:'5'});
    for(let n=0;n<3;n++) await pay(unequal.installments[n].id,`2003-01-0${n+1}`,600);
    assert.deepEqual(await amounts(unequal.id),[400,400,200]);
    await asUser(manager);
    assert.deepEqual((await db.query<{amount:string}>("select cc.amount from commercial_commissions cc join payments p on p.id=cc.payment_id join installments i on i.id=p.installment_id where i.contract_id=$1 order by p.payment_date,p.created_at,p.id",[unequal.id])).rows.map(r=>Number(r.amount)),[200,200,100]);
    const customProportional=await create({origin:'Tráfego HP',percentage:'10',commercialPercentage:'15',commissionMode:'proportional'});
    const customPayment=await pay(customProportional.installments[0].id,'2003-02-01',1080);
    assert.deepEqual(await amounts(customProportional.id),[108]);
    await asUser(manager);
    assert.equal(Number((await db.query<{amount:string}>("select amount from commercial_commissions where payment_id=$1",[customPayment])).rows[0].amount),162);
    await asUser(lawyer);
    await assert.rejects(db.query("select save_contract_payout_terms_v2($1,5,15,null,'Tentativa de mudar beneficiário após pagamento','Outra pessoa')",[traffic.id]),/movimentado/);
    await assert.rejects(db.query("select private.save_commercial_recipient($1,'Outra pessoa','Tentativa direta')",[traffic.id]),/permission denied/);
    assert.equal((await agenda()).items.some(r=>r.recipient==='commercial'),false);
    const personalReport=(await db.query<{data:{payout_agenda:{items:Item[];commercial_transfers?:unknown[]}}}>("select closed_month_report($1) as data",[closing])).rows[0].data;
    assert.equal(personalReport.payout_agenda.items.some(i=>i.recipient==='commercial'),false);
    assert.equal('commercial_transfers' in personalReport.payout_agenda,false);
    assert.equal('commercial_transfers' in await agenda(),false);
    assert.equal((await db.query("select * from commercial_commissions")).rows.length,0);
    await assert.rejects(transfer(traffic.id,'lawyer',100),/não autorizado/);
    await asUser(colleague);await assert.rejects(agenda(),/indisponível/);
    await asUser(secretary);await assert.rejects(agenda(),/não autorizado/);
    assert.equal((await db.query("select commercial_recipient_name from contract_financial_terms")).rows.length,0);
    assert.equal((await db.query("select * from commercial_transfers")).rows.length,0);
    assert.equal((await db.query("select * from commercial_commissions")).rows.length,0);
    await db.exec('reset role;reset request.jwt.claim.sub');
    const otherOffice=randomUUID(),otherManager=randomUUID();
    await db.query("insert into offices(id,name,slug) values($1,'Outro escritório','outro-comercial')",[otherOffice]);
    await db.query("insert into auth.users(id,email) values($1,'other-manager@example.com')",[otherManager]);
    await db.query("update profiles set active=true,role='manager',office_id=$2 where id=$1",[otherManager,otherOffice]);
    await asUser(otherManager);await assert.rejects(agenda(),/não autorizado/);
    await assert.rejects(db.query("select save_contract_payout_terms_v2($1,5,15,null,'Tentativa fora do escritório','Outra pessoa')",[traffic.id]),/não autorizado/);
    await assert.rejects(transfer(normal.id,'commercial',1),/não autorizado/);
    await db.exec('reset role;reset request.jwt.claim.sub');
    await db.exec(await readFile(new URL('20261103000400_commercial_payouts.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('20261103000600_commercial_recipient.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('20261103000600_commercial_recipient.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('20261104000100_custom_commercial_percentages.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('20261104000100_custom_commercial_percentages.sql',migrations),'utf8'));
    await asUser(manager);assert.equal((await agenda()).items.find(r=>r.contract_id===traffic.id)?.due_date,'2001-02-20','reaplicação não reescreve a data revisada');
    assert.ok(first);
  } finally {await db.close();}
});
