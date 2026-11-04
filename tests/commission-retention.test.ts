import assert from "node:assert/strict";
import { test } from "node:test";
import { commercialTargetCents, commissionTargetCents, projectContractCommissions } from "../src/lib/contracts/commission-retention";
import { blankContractForm, prepareContract } from "../src/lib/contracts/registration";
import { buildWallet } from "../src/lib/contracts/wallet";
import type { ContractRecord } from "../src/lib/contracts/view";

test("retenção integral consome as primeiras parcelas e limita a última retenção ao saldo da comissão", () => {
  const items = [1, 2, 3].map((index) => ({ id: String(index), dueDate: `2026-0${index}-10`, order: index,
    contractualCents: 100000, paidCents: 0 }));
  const terms = { commission_mode: "upfront" as const, commission_percentage: 25, total_contract_value: 10000 };
  const result = projectContractCommissions(items, terms, 0);
  assert.deepEqual([...result.values()].map((row) => row.estimatedCents), [100000, 100000, 50000]);
  const lowPercentage = projectContractCommissions(items, { ...terms, commission_percentage: 5 }, 0);
  assert.deepEqual([...lowPercentage.values()].map((row) => row.estimatedCents), [50000, 0, 0]);
  assert.equal(commissionTargetCents({ ...terms, total_contract_value: null, commission_upfront_limit: 750 }), 75000);
  assert.throws(() => projectContractCommissions(items, { ...terms, total_contract_value: null }, 0), /sem limite/);
});

test("tráfego divide a retenção e a previsão com o comercial, preservando limites e centavos", () => {
  const terms = { commission_mode: "upfront" as const, commission_percentage: 5, commercial_percentage: 5, total_contract_value: 10000 };
  const items = [1,2,3].map(i=>({id:String(i),dueDate:`2026-0${i}-10`,order:i,contractualCents:50000,paidCents:i===1?50000:0}));
  const results = [...projectContractCommissions(items,terms,25000).values()];
  assert.deepEqual(results.map(r=>r.estimatedCents),[25000,25000,0]);
  assert.deepEqual(results.map(r=>r.remainingEstimatedCents),[0,25000,0]);
  const pennies = [1,2,3,4].map(i=>({...items[0],id:String(i),order:i,contractualCents:1,paidCents:0}));
  assert.deepEqual([...projectContractCommissions(pennies,{...terms,total_contract_value:.4},0).values()].map(r=>r.estimatedCents),[1,0,1,0]);
  const values = {...blankContractForm,clientName:"Cliente Teste",cpf:"52998224725",serviceName:"Revisional",contractDate:"01/10/2026",
    origin:"Tráfego HP",percentage:"5",commissionMode:"proportional" as const,commercialRecipientName:"Marina Comercial",method:"cash" as const,total:"10.000,00",count:"1",installmentValue:"10.000,00",paymentStartType:"fixed_date" as const,firstDue:"10/10/2026"};
  assert.equal(prepareContract(values).payoutDay,null);
  assert.equal(prepareContract({...values,origin:"Cliente próprio"}).payoutDay,null);
  assert.throws(()=>prepareContract({...values,commissionMode:""}),/como será feito/);
  assert.throws(()=>prepareContract({...values,commissionMode:"upfront"}),/destinadas/);
  assert.equal(prepareContract({...values,percentage:"10",commercialPercentage:"15"}).commercialPercentage,15);
  assert.throws(()=>prepareContract({...values,percentage:"60",commercialPercentage:"45"}),/100%/);
  assert.throws(()=>prepareContract({...values,commercialPercentage:"7"}),/percentual permitido/);
  assert.equal(prepareContract({...values,commercialRecipientName:"  Marina Comercial  "}).commercialRecipientName,"Marina Comercial");
  assert.throws(()=>prepareContract({...values,commercialRecipientName:""}),/nome/);
  assert.throws(()=>prepareContract({...values,commercialRecipientName:"A".repeat(161)}),/nome/);
});

test("retenção integral personalizável divide pelos limites individuais sem perder centavos", () => {
  const terms = {commission_mode:"upfront" as const,commission_percentage:10,commercial_percentage:5,total_contract_value:10000};
  const items=[1,2,3].map(i=>({id:String(i),dueDate:`2026-0${i}-10`,order:i,contractualCents:60000,paidCents:i===1?60000:0}));
  assert.equal(commercialTargetCents(terms),50000);
  const results=[...projectContractCommissions(items,terms,40000).values()];
  assert.deepEqual(results.map(row=>row.estimatedCents),[40000,40000,20000]);
  assert.deepEqual(results.map(row=>row.remainingEstimatedCents),[0,40000,20000]);
  assert.equal(commercialTargetCents({...terms,total_contract_value:null,commission_upfront_limit:1000,commercial_percentage:15}),150000);
  const pennies=[1,2,3,4,5,6].map(i=>({...items[0],id:String(i),order:i,contractualCents:1,paidCents:0}));
  assert.deepEqual([...projectContractCommissions(pennies,{...terms,commission_percentage:5,commercial_percentage:10,total_contract_value:.4},0).values()].map(row=>row.estimatedCents),[0,1,0,0,1,0]);
});

test("terceiro recebe um total fixo também em cliente próprio, sem reaplicar a participação já quitada",()=>{
  const terms={commission_mode:"upfront" as const,commission_percentage:5,total_contract_value:10000,commercial_percentage:0,third_party_upfront_limit:750};
  const items=[1,2,3].map(i=>({id:String(i),dueDate:`2026-0${i}-10`,order:i,contractualCents:100000,paidCents:i===1?100000:0}));
  const rows=[...projectContractCommissions(items,terms,40000).values()];
  assert.equal(commercialTargetCents(terms),75000);
  assert.deepEqual(rows.map(row=>row.estimatedCents),[40000,10000,0]);
  assert.deepEqual(rows.map(row=>row.remainingEstimatedCents),[0,10000,0]);
  const values={...blankContractForm,clientName:"Cliente Teste",cpf:"52998224725",serviceName:"Revisional",contractDate:"01/10/2026",origin:"Cliente próprio",percentage:"5",commissionMode:"upfront" as const,upfrontDistribution:"shared" as const,thirdPartyTotal:"750,00",commercialRecipientName:"Parceiro Teste",method:"cash" as const,total:"10.000,00",count:"1",installmentValue:"10.000,00",paymentStartType:"fixed_date" as const,firstDue:"10/10/2026"};
  assert.equal(prepareContract(values).thirdPartyLimitCents,75000);
  const solo=prepareContract({...values,upfrontDistribution:"lawyer_only"});
  assert.equal(solo.thirdPartyLimitCents,null);assert.equal(solo.commercialRecipientName,null);
  assert.throws(()=>prepareContract({...values,thirdPartyTotal:"9.600,00"}),/ultrapassar/);
  assert.throws(()=>prepareContract({...values,thirdPartyTotal:""}),/total/);
});

test("previsão mensal não cobra a comissão novamente quando os primeiros recebimentos já a quitaram", () => {
  const contract: ContractRecord = { id: "c", client_id: "client", client_name: "Cliente Teste", client_cpf: null,
    origin: "Cliente próprio", contract_date: "2026-09-01", total_contract_value: 10000,
    payment_method: "installments", contract_file_path: null, contract_file_name: null,
    commission_percentage: 5, commission_mode: "upfront", installments: [
      { id: "i1", installment_number: 1, kind: "regular", regular_number: 1, due_date: "2026-10-10", contractual_amount: 1000,
        payments: [{ id: "p1", payment_date: "2026-10-10", amount_paid: 1080, commissions: { commission_amount: 500 } }] },
      { id: "i2", installment_number: 2, kind: "regular", regular_number: 2, due_date: "2026-11-10", contractual_amount: 1000, payments: [] },
    ] };
  const wallet = buildWallet([contract], "2026-10-26", "2026-10");
  assert.equal(wallet.current.contractualCents, 100000);
  assert.equal(wallet.current.estimatedCents, 50000);
  assert.equal(wallet.current.generatedCents, 50000);
  assert.equal(wallet.next.estimatedCents, 0);
  assert.equal(wallet.next.remainingParticipationCents, 0);
  assert.equal(wallet.overdueParticipationCents, 0);
  const proportional = buildWallet([{ ...contract, commission_mode: "proportional" }], "2026-10-26", "2026-10");
  assert.equal(proportional.current.estimatedCents, 5000);
  assert.equal(proportional.next.remainingParticipationCents, 5000);
});

test("limite manual de êxito é uma comissão monetária explícita, independente do percentual cobrado do cliente", () => {
  const form = { ...blankContractForm, clientName: "Cliente Teste", cpf: "52998224725", serviceName: "Ação revisional",
    contractDate: "26/10/2026", origin: "Cliente próprio", percentage: "5", method: "success_only" as const,
    successFeePercentage: "30", commissionMode: "upfront" as const, upfrontDistribution:"lawyer_only" as const,commissionLimit: "750,00" };
  const preview = prepareContract(form);
  assert.equal(preview.commissionLimitCents, 75000);
  assert.equal(preview.totalCents, null);
  assert.equal(preview.percentage, 5);
  assert.deepEqual(preview.rows, []);
  for (const invalid of ["", "0", "-100", "abc"])
    assert.throws(() => prepareContract({ ...form, commissionLimit: invalid }), /limite total/);
});
