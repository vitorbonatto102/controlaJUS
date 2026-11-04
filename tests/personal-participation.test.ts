import assert from "node:assert/strict";
import {test} from "node:test";
import {buildFinancialRows,buildLawyerFinancialRows,hasPendingContractParticipation,type ContractRecord} from "../src/lib/contracts/view";
import {buildWallet} from "../src/lib/contracts/wallet";
import {buildLawyerOverview} from "../src/lib/dashboard/lawyer-overview";

const fixture=():ContractRecord=>({id:"c",client_id:"client",client_name:"Cliente Demonstração",client_cpf:null,origin:"Tráfego HP",contract_date:"2026-01-01",total_contract_value:6000,payment_method:"installments",contract_file_path:null,contract_file_name:null,commission_percentage:5,commercial_percentage:5,commission_mode:"upfront",upfront_distribution:"shared",third_party_upfront_limit:300,commercial_recipient_name:"Rafael Demonstração",has_additional_fee:true,
  installments:Array.from({length:24},(_,index)=>({id:`i${index}`,installment_number:index+1,regular_number:index+1,kind:"regular" as const,due_date:`${2026+Math.floor(index/12)}-${String(index%12+1).padStart(2,"0")}-10`,contractual_amount:250,payments:[]}))});

test("600 reais de retenção conjunta ocupam três parcelas, sem apagar as 24 do escritório",()=>{
  const contract=fixture(),rows=buildLawyerFinancialRows([contract],"2026-01-01");
  assert.equal(buildFinancialRows([contract],"2026-01-01").length,24);
  assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.estimatedCents),[12500,12500,5000]);
  assert.deepEqual(rows.map(r=>r.thirdPartyEstimatedCents),[12500,12500,5000]);
  assert.deepEqual(rows.map(r=>r.officeEstimatedCents),[0,0,15000]);
  assert.equal(buildWallet([contract],"2026-01-01","2026-04").current.contractualCents,0);
  assert.equal(contract.installments.length,24);
});

test("retenção concluída preserva três parcelas históricas, sem avisos de atraso das demais",()=>{
  const contract=fixture();
  [125,125,50,0].forEach((amount,index)=>contract.installments[index].payments.push({id:`p${index}`,payment_date:contract.installments[index].due_date,amount_paid:250,commissions:{commission_amount:amount}}));
  assert.equal(hasPendingContractParticipation(contract,"2026-11-04"),false);
  assert.equal(buildLawyerFinancialRows([contract],"2026-11-04").length,3);
  const wallet=buildWallet([contract],"2026-11-04","2026-04");
  assert.equal(wallet.current.receivedCents,0);assert.equal(wallet.overdueCount,0);
  const overview=buildLawyerOverview([contract],[],[],[],"2026-11-04");
  assert.equal(overview.activeContractCount,0);assert.equal(overview.upcoming.length,0);assert.equal(overview.futureEvents.length,0);
  contract.installments[2].payments[0].voided_at="2026-11-04T12:00:00Z";
  // O quarto pagamento passa a completar a retenção; a visão não fica presa a números fixos de parcelas.
  contract.installments[3].payments[0].commissions={commission_amount:50};
  assert.equal(buildLawyerFinancialRows([contract],"2026-11-04").some(row=>row.installmentId==="i3"),true);
});

test("adiantamento quita em uma parcela e não deixa previsões artificiais nas seguintes",()=>{
  const contract=fixture();contract.installments[0].payments=[{id:"p",payment_date:"2026-01-10",amount_paid:600,commissions:{commission_amount:300}}];
  assert.equal(buildLawyerFinancialRows([contract],"2026-01-11").length,1);
  assert.equal(buildWallet([contract],"2026-01-11","2026-02").current.estimatedCents,0);
});
