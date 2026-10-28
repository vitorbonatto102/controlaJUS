import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWallet, filterWalletRows, shiftMonth, walletBalance } from "../src/lib/contracts/wallet";
import type { ContractRecord, InstallmentRecord } from "../src/lib/contracts/view";

function installment(overrides: Partial<InstallmentRecord> = {}): InstallmentRecord {
  return { id: "installment-1", installment_number: 1, kind: "regular", regular_number: 1,
    due_date: "2026-10-10", contractual_amount: 1000, payments: [], ...overrides };
}
function contract(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return { id: "contract-1", client_id: "client-1", client_name: "Cliente teste", client_cpf: null,
    origin: "Cliente próprio", contract_date: "2026-09-01", total_contract_value: 1000,
    payment_method: "installments", commission_percentage: 40,
    contract_file_path: null, contract_file_name: null, installments: [installment()],
    engagement_status: "confirmed", closed_on: overrides.contract_date ?? "2026-09-01", ...overrides };
}

test("carteira distribui pagamentos por sua data, ignora estornos e preserva comissão sobre juros", () => {
  const data = [contract({ installments: [installment({ payments: [
    { id: "p1", payment_date: "2026-09-30", amount_paid: 400, commissions: { commission_amount: 160 } },
    { id: "p2", payment_date: "2026-10-15", amount_paid: 680, commissions: { commission_amount: 272 } },
    { id: "p3", payment_date: "2026-10-12", amount_paid: 1000, commissions: { commission_amount: 400 }, voided_at: "2026-10-13" },
  ] })] })];
  const result = buildWallet(data, "2026-10-22", "2026-10");
  assert.equal(result.current.receivedCents, 68000);
  assert.equal(result.current.generatedCents, 27200);
  assert.equal(result.current.estimatedCents, 40000);
  assert.equal(result.receivedCents, 108000);
  assert.equal(result.timeline.find((month) => month.month === "2026-09")?.generatedCents, 16000);
  assert.equal(result.overdueCount, 0);
  assert.equal(result.previousContractCount, 1);
  assert.equal(walletBalance(data, []).generatedCents, 43200);
});

test("previsão considera somente saldo pendente e não inventa valores de êxito ou datas condicionadas", () => {
  const data = [contract({ total_contract_value: 2000, installments: [
    installment({ due_date: "2026-11-10", payments: [
      { id: "p1", payment_date: "2026-10-20", amount_paid: 250, commissions: { commission_amount: 100 } },
    ] }),
    installment({ id: "item-2", due_date: "2026-11-20", payments: [
      { id: "p2", payment_date: "2026-10-20", amount_paid: 1080, commissions: { commission_amount: 432 } },
    ] }),
  ] }), contract({ id: "success", total_contract_value: null, payment_method: "success_only", installments: [] }),
  contract({ id: "condition", total_contract_value: 3000, payment_start_type: "condition", installments: [] })];
  const result = buildWallet(data, "2026-10-22", "2026-10");
  assert.equal(result.next.contractualCents, 200000);
  assert.equal(result.next.remainingCents, 75000);
  assert.equal(result.next.remainingParticipationCents, 30000);
  assert.equal(result.current.generatedCents, 53200);
  assert.equal(result.totalContractedCents, 500000);
  assert.equal(result.contractedParticipationCents, 200000);
  assert.equal(result.previousContractCount, 3);
  assert.equal(result.previousUnknownCount, 1);
});

test("referência atravessa o ano, inclui parcelas futuras distantes e mantém meses vazios", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  const result = buildWallet([contract({ contract_date: "2026-11-15", installments: [
    installment({ due_date: "2027-01-10" }),
  ] })], "2026-12-22", "2026-12");
  assert.equal(result.previousContractCount, 1);
  assert.equal(result.next.month, "2027-01");
  assert.equal(result.next.remainingParticipationCents, 40000);
  assert.equal(result.timeline.length, 12);
  assert.equal(result.outlook.length, 6);
  assert.equal(result.outlook[5].month, "2027-06");
  assert.equal(buildWallet([], "2026-12-22", "2026-12").current.generatedCents, 0);
});

test("saldo ignora repasses estornados e pagamentos sem comissão não viram comissão efetiva", () => {
  const data = [contract({ installments: [installment({ payments: [
    { id: "p1", payment_date: "2026-10-20", amount_paid: 500, commissions: { commission_amount: 200 } },
    { id: "p2", payment_date: "2026-10-20", amount_paid: 500, commissions: null },
  ] })] })];
  const result = buildWallet(data, "2026-10-22", "2026-10");
  assert.equal(result.current.receivedCents, 100000);
  assert.equal(result.current.generatedCents, 20000);
  assert.equal(result.rows[0].commissionCents, 20000);
  assert.equal(result.missingCommissionCount, 1);
  assert.deepEqual(walletBalance(data, [
    { id: "t1", payment_date: "2026-10-20", amount: 250, reversed_at: null },
    { id: "t2", payment_date: "2026-10-20", amount: 100, reversed_at: "2026-10-21" },
  ]), { generatedCents: 20000, transferredCents: 25000, pendingCents: 0, overpaidCents: 5000 });
});

test("lista combina período, vencimento e inadimplência incluindo pagamentos parciais", () => {
  const { rows, overdueParticipationCents } = buildWallet([contract({ installments: [
    installment({ due_date: "2026-09-10", payments: [
      { id: "p1", payment_date: "2026-09-10", amount_paid: 400, commissions: { commission_amount: 160 } },
    ] }), installment({ id: "item-2", due_date: "2026-11-10" }),
  ] })], "2026-10-22", "2026-10");
  assert.equal(overdueParticipationCents, 24000);
  const filters = { referenceMonth: "2026-10", allPeriods: false, dueDate: "", status: "" };
  assert.equal(filterWalletRows(rows, filters, "2026-10-22").length, 0);
  assert.equal(filterWalletRows(rows, { ...filters, allPeriods: true, status: "delinquent" }, "2026-10-22")[0].installmentId, "installment-1");
  assert.equal(filterWalletRows(rows, { ...filters, allPeriods: true, dueDate: "2026-11-10", status: "upcoming" }, "2026-10-22").length, 1);
  assert.equal(filterWalletRows(rows, { ...filters, allPeriods: true, status: "paid" }, "2026-10-22").length, 0);
});
