import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLawyerOverview, percentageChange, previousComparableDate } from "../src/lib/dashboard/lawyer-overview";
import { contractGoalProgress } from "../src/lib/dashboard/goals";
import type { ContractRecord } from "../src/lib/contracts/view";
import type { Closing, Transfer } from "../src/lib/finance/data";

test("painel distingue previsão, comissão efetiva e repasse; exclui estornos e registros futuros", () => {
  const contract: ContractRecord = { id: "contract", client_id: "client", client_name: "Cliente Teste", client_cpf: null,
    engagement_status: "confirmed", closed_on: "2026-10-03", service_name: "Revisional", origin: "Cliente próprio", contract_date: "2026-10-03", total_contract_value: 3000,
    payment_method: "installments", contract_file_path: null, contract_file_name: null, commission_percentage: 40,
    installments: [
      { id: "old", installment_number: 1, kind: "regular", regular_number: 1, due_date: "2026-09-10", contractual_amount: 1000,
        payments: [{ id: "partial", payment_date: "2026-09-20", amount_paid: 500, commissions: { commission_amount: 200 } }] },
      { id: "current", installment_number: 2, kind: "regular", regular_number: 2, due_date: "2026-10-28", contractual_amount: 1000,
        payments: [{ id: "actual", payment_date: "2026-10-20", amount_paid: 500, commissions: { commission_amount: 200 } },
          { id: "void", payment_date: "2026-10-21", amount_paid: 400, voided_at: "2026-10-22", commissions: { commission_amount: 160 } },
          { id: "future", payment_date: "2026-10-30", amount_paid: 500, commissions: { commission_amount: 200 } }] },
      { id: "next", installment_number: 3, kind: "regular", regular_number: 3, due_date: "2026-11-28", contractual_amount: 1000, payments: [] },
    ] };
  const closing = { status: "closed", amount_pending_transfer: 150 } as Closing;
  const draft = { status: "draft", amount_pending_transfer: 999 } as Closing;
  const transfer = { id: "t", amount: 50, payment_date: "2026-10-20", reversed_at: null } as Transfer;
  const data = buildLawyerOverview([contract], [closing, draft], [transfer,
    { ...transfer, id: "void", amount: 999, reversed_at: "2026-10-21" },
    { ...transfer, id: "future", amount: 999, payment_date: "2026-10-30" }], [], "2026-10-28");
  assert.equal(data.wallet.current.estimatedCents, 40000);
  assert.equal(data.wallet.current.generatedCents, 20000);
  assert.equal(data.wallet.current.receivedCents, 50000);
  assert.equal(data.confirmedPendingCents, 15000);
  assert.equal(data.transferredThisMonthCents, 5000);
  assert.equal(data.wallet.overdueParticipationCents, 20000);
  assert.equal(data.dueTodayCount, 1);
  assert.equal(data.upcoming.length, 1, "uma próxima parcela por contrato");
  assert.equal(data.upcoming[0].installmentId, "current");
  assert.equal(data.wallet.currentContractCount, 1);
  assert.equal(data.previousGeneratedCents, 20000);
  assert.equal(data.commissionChange, 0);
  assert.deepEqual(data.origins, [{ origin: "Cliente próprio", cents: 20000 }]);
  assert.equal(data.timeline.length, 6);
});

test("meta de contratos e comparação de calendário funcionam sem metas ou base anterior artificiais", () => {
  assert.equal(previousComparableDate("2026-03-31"), "2026-02-28");
  assert.equal(previousComparableDate("2028-03-31"), "2028-02-29");
  assert.equal(previousComparableDate("2026-01-05"), "2025-12-05");
  assert.equal(percentageChange(100, 0), null);
  assert.equal(percentageChange(0, 100), -100);
  assert.deepEqual(contractGoalProgress(7, 10), { percentage: 70, barPercentage: 70, remaining: 3, reached: false });
  assert.deepEqual(contractGoalProgress(12, 10), { percentage: 120, barPercentage: 100, remaining: 0, reached: true });
  assert.deepEqual(contractGoalProgress(0, null), { percentage: 0, barPercentage: 0, remaining: null, reached: false });
  const empty = buildLawyerOverview([], [], [], [], "2026-10-28");
  assert.equal(empty.wallet.current.generatedCents, 0);
  assert.equal(empty.activeContractCount, 0);
  assert.deepEqual(empty.upcoming, []);
});
