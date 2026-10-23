import assert from "node:assert/strict";
import { test } from "node:test";
import { blankContractForm, prepareContract } from "../src/lib/contracts/registration";
import { filterFollowUpContracts, followUpReasons, type FollowUpContract } from "../src/lib/contracts/follow-up";
import { summarizeContracts, type ContractRecord } from "../src/lib/contracts/view";

const form = { ...blankContractForm, clientName: "Cliente Teste", cpf: "52998224725", serviceName: "Ação indenizatória", contractDate: "07/10/2026",
  method: "success_only" as const, successFeePercentage: "30", origin: "Cliente próprio", percentage: "40" };

test("apenas no êxito exige somente percentual e não fabrica valores, parcelas ou vencimentos", () => {
  const preview = prepareContract({ ...form, total: "1.000,00", firstDue: "10/12/2026", count: "3" });
  assert.equal(preview.method, "success_only");
  assert.equal(preview.successFeePercentage, 30);
  assert.equal(preview.totalCents, null);
  assert.equal(preview.firstDueDate, null);
  assert.deepEqual(preview.rows, []);
  const contract: ContractRecord = { id: "c", client_id: "client", client_name: "Cliente Teste", client_cpf: null,
    origin: "Cliente próprio", contract_date: "2026-10-07", payment_method: "success_only",
    total_contract_value: null, success_fee_percentage: 30, commission_percentage: 40,
    contract_file_name: null, contract_file_path: null, installments: [] };
  const summary = summarizeContracts([contract], "2026-10-22");
  assert.equal(summary.totalContractedCents, 0);
  assert.equal(summary.contractedParticipationCents, 0);
  assert.equal(summary.monthlyEstimateCents, 0);
  assert.deepEqual(summary.rows, []);
});

test("percentual de êxito é validado sem assumir 30% quando não informado", () => {
  for (const value of ["", "0", "101", "30.123", "abc"]) {
    assert.throws(() => prepareContract({ ...form, successFeePercentage: value }), /percentual cobrado/);
  }
  assert.equal(prepareContract({ ...form, successFeePercentage: "25,5" }).successFeePercentage, 25.5);
});

test("acompanhamento inclui êxito, adicionais e condicionados sem duplicar contratos", () => {
  const base: FollowUpContract = { id: "normal", clientId: "client", clientName: "José Teste", lawyerId: "a",
    lawyerName: "Advogada A", clientCpf: "52998224725", origin: "Cliente próprio", contractDate: "2026-10-07", totalValue: 1000, payment_method: "cash",
    successFeePercentage: null, additionalFeePercentage: null, additionalFeeAmount: null,
    additionalFeeBasis: null, paymentCondition: null };
  const contracts = [base, { ...base, id: "success", totalValue: null, payment_method: "success_only", successFeePercentage: 30 },
    { ...base, id: "condition", has_additional_fee: true, payment_start_type: "condition" },
    { ...base, id: "additional", lawyerId: "b", has_additional_fee: true }];
  assert.deepEqual(followUpReasons(contracts[2]), ["additional_fee", "condition"]);
  assert.equal(filterFollowUpContracts(contracts, { reason: "", lawyerId: "", client: "" }).length, 3);
  assert.deepEqual(filterFollowUpContracts(contracts, { reason: "condition", lawyerId: "a", client: "jose" }).map((c) => c.id), ["condition"]);
  assert.equal(filterFollowUpContracts(contracts, { reason: "success_only", lawyerId: "b", client: "" }).length, 0);
  assert.equal(filterFollowUpContracts(contracts, { cpf: "529.982.247-25", origin: "Cliente próprio", dateFrom: "2026-10-07", dateTo: "2026-10-07" }).length, 3);
  assert.equal(filterFollowUpContracts(contracts, { cpf: "982247" }).length, 3);
  assert.equal(filterFollowUpContracts(contracts, { cpf: "111444" }).length, 0);
  assert.equal(filterFollowUpContracts(contracts, { dateFrom: "2026-10-08" }).length, 0);
  assert.equal(filterFollowUpContracts(contracts, { dateTo: "2026-10-06" }).length, 0);
  assert.equal(filterFollowUpContracts(contracts, { dateFrom: "2026-11-01", dateTo: "2026-10-01" }).length, 0);
  assert.equal(filterFollowUpContracts(contracts, { origin: "Tráfego HP" }).length, 0);
  assert.deepEqual(filterFollowUpContracts(contracts, { valueStatus: "unknown", paymentMethod: "success_only" }).map((c) => c.id), ["success"]);
  assert.equal(filterFollowUpContracts(contracts, { valueStatus: "known" }).length, 2);
  assert.equal(filterFollowUpContracts([{ ...contracts[2], paymentCondition: "Após liberação do alvará" }], { terms: "ALVARA" }).length, 1);
  assert.equal(filterFollowUpContracts([{ ...contracts[2], additionalFeeBasis: "Proveito econômico" }], { terms: "economico" }).length, 1);
});
