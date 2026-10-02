import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFinancialRows, summarizeContracts, type ContractRecord } from "../src/lib/contracts/view";
import { buildOperationalRows, filterOperationalRows, operationalStatus, summarizeOperations,
  type OperationalContract, type OperationalFilters, type OperationalNote } from "../src/lib/secretary/view";

const today = "2026-10-02";
const contract: OperationalContract = {
  id: "c1", client_id: "client1", lawyer_id: "lawyer1", lawyer_name: "Ana",
  client_name: "Cliente Um", client_cpf: null, origin: "Cliente próprio", contract_date: "2026-09-01",
  installments: [
    { id: "i1", contract_id: "c1", installment_number: 1, kind: "regular", regular_number: 1,
      due_date: "2026-09-10", contractual_amount: 1000, payments: [] },
    { id: "i2", contract_id: "c1", installment_number: 2, kind: "regular", regular_number: 2,
      due_date: today, contractual_amount: 1000, payments: [] },
    { id: "i3", contract_id: "c1", installment_number: 3, kind: "regular", regular_number: 3,
      due_date: "2026-10-10", contractual_amount: 1000, payments: [] },
  ],
};
const payment = (id: string, amount: number, date: string, voided_at: string | null = null) => ({
  id, installment_id: "i1", payment_date: date, amount_paid: amount, recorded_by: "secretary1",
  created_at: `${date}T12:00:00Z`, observation: null, voided_at,
  void_reason: voided_at ? "Erro de lançamento" : null, replaces_payment_id: null,
});
const emptyFilters: OperationalFilters = {
  lawyerId: "", clientId: "", month: "", year: "", status: "", dueDate: "", origin: "",
};

test("status operacional distingue vencida, hoje, futura, parcial e paga", () => {
  assert.equal(operationalStatus(100000, 0, "2026-09-10", today), "overdue");
  assert.equal(operationalStatus(100000, 0, today, today), "today");
  assert.equal(operationalStatus(100000, 0, "2026-10-10", today), "upcoming");
  assert.equal(operationalStatus(100000, 60000, "2026-09-10", today), "partial");
  assert.equal(operationalStatus(100000, 100000, "2026-09-10", today), "paid");
  assert.equal(operationalStatus(100000, 108000, "2026-09-10", today), "paid");
});

test("pagamentos múltiplos e estorno mudam saldo, métricas e participação da advogada", () => {
  const copy = structuredClone(contract);
  copy.installments[0].payments = [payment("p1", 600, "2026-10-01"),
    payment("p2", 400, "2026-10-02"), payment("p3", 80, "2026-10-02")];
  let rows = buildOperationalRows([copy], [], today);
  assert.equal(rows[0].paidCents, 108000);
  assert.equal(rows[0].balanceCents, 0);
  assert.equal(rows[0].status, "paid");
  let summary = summarizeOperations(rows, [copy], today);
  assert.equal(summary.paymentsThisMonth, 3);
  assert.equal(summary.receivedCentsThisMonth, 108000);
  copy.installments[0].payments[1].voided_at = "2026-10-02T15:00:00Z";
  rows = buildOperationalRows([copy], [], today);
  summary = summarizeOperations(rows, [copy], today);
  assert.equal(rows[0].paidCents, 68000);
  assert.equal(rows[0].balanceCents, 32000);
  assert.equal(rows[0].status, "partial");
  assert.equal(summary.overdue, 1);
  assert.equal(summary.paymentsThisMonth, 2);
  const lawyerContract: ContractRecord = {
    id: copy.id, client_id: copy.client_id, client_name: copy.client_name,
    client_cpf: null, origin: copy.origin, contract_date: copy.contract_date,
    total_contract_value: 3000, payment_method: "installments", contract_file_path: null,
    contract_file_name: null, commission_percentage: 40,
    installments: copy.installments.map((item) => ({ ...item, payments: item.payments.map((p) => ({
      id: p.id, payment_date: p.payment_date, amount_paid: p.amount_paid,
      voided_at: p.voided_at, commissions: { commission_amount: p.amount_paid * 0.4 },
    })) })),
  };
  assert.equal(buildFinancialRows([lawyerContract], today)[0].commissionCents, 27200);
  assert.equal(summarizeContracts([lawyerContract], today).monthlyGeneratedCents, 27200);
});

test("filtros por advogada, mês, ano, inadimplência e último contato", () => {
  const second = structuredClone(contract);
  second.id = "c2"; second.client_id = "client2"; second.lawyer_id = "lawyer2";
  second.lawyer_name = "Beatriz"; second.client_name = "Cliente Dois";
  second.installments = second.installments.map((item) => ({ ...item, id: `${item.id}b`, contract_id: "c2" }));
  const notes: OperationalNote[] = [
    { id: "n1", client_id: "client1", contract_id: "c1", installment_id: "i1", author_id: "s1",
      author_name: "Maria", note_type: "collection", content: "Primeiro contato", created_at: "2026-09-18T10:00:00Z" },
    { id: "n2", client_id: "client1", contract_id: "c1", installment_id: "i1", author_id: "s1",
      author_name: "Maria", note_type: "client_reply", content: "Cliente respondeu", created_at: "2026-09-25T10:00:00Z" },
  ];
  const rows = buildOperationalRows([contract, second], notes, today);
  assert.equal(rows.find((row) => row.installmentId === "i1")?.latestContactAt, "2026-09-25T10:00:00Z");
  assert.equal(filterOperationalRows(rows, { ...emptyFilters, lawyerId: "lawyer1" }, today).length, 3);
  assert.equal(filterOperationalRows(rows, { ...emptyFilters, month: "09", year: "2026" }, today).length, 2);
  assert.equal(filterOperationalRows(rows, { ...emptyFilters, month: "09", year: "2025" }, today).length, 0);
  assert.equal(filterOperationalRows(rows, { ...emptyFilters, status: "delinquent" }, today).length, 2);
  assert.equal(filterOperationalRows(rows, { ...emptyFilters, dueDate: today }, today).length, 2);
});
