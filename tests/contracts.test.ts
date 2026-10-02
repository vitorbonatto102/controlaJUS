import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchedule, addMonthsClamped } from "../src/lib/contracts/schedule";
import { numericToCents, parseMoneyBR, participationCents } from "../src/lib/contracts/finance";
import { formatCpf, isValidCpf, PERCENTAGES } from "../src/lib/contracts/validation";
import { buildFinancialRows, filterFinancialRows, installmentStatus,
  summarizeContracts, type ContractRecord } from "../src/lib/contracts/view";
import { formatBRL, formatDateBR } from "../src/lib/formatters";

test("CPF usa dígitos verificadores e máscara", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("529.982.247-26"), false);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(formatCpf("52998224725"), "529.982.247-25");
});

test("contrato à vista gera uma parcela", () => {
  const result = buildSchedule({ method: "cash", totalCents: 1000000,
    cashCents: 1000000, cashDueDate: "2026-10-10" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount_cents, 1000000);
  assert.equal(result.differenceCents, 0);
});

test("parcelamento atravessa o ano e mantém o dia âncora", () => {
  const result = buildSchedule({ method: "installments", totalCents: 300000,
    count: 3, installmentCents: 100000, firstDueDate: "2026-11-10" });
  assert.deepEqual(result.rows.map((row) => row.due_date),
    ["2026-11-10", "2026-12-10", "2027-01-10"]);
  assert.equal(result.differenceCents, 0);
});

test("entrada e oito parcelas compõem o cronograma", () => {
  const result = buildSchedule({ method: "installments", totalCents: 1000000,
    count: 8, installmentCents: 100000, firstDueDate: "2026-11-10",
    entryCents: 200000, entryDueDate: "2026-10-10" });
  assert.equal(result.rows.length, 9);
  assert.equal(result.rows[0].kind, "down_payment");
  assert.equal(result.rows[1].regular_number, 1);
  assert.equal(result.rows[8].regular_number, 8);
  assert.equal(result.differenceCents, 0);
});

test("dia 31 é limitado ao último dia e retorna ao dia original", () => {
  assert.equal(addMonthsClamped("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonthsClamped("2027-01-31", 2), "2027-03-31");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsClamped("2027-01-29", 1), "2027-02-28");
  assert.equal(addMonthsClamped("2027-01-29", 2), "2027-03-29");
  assert.equal(addMonthsClamped("2027-01-30", 2), "2027-03-30");
});

test("divergência permanece explícita e não altera centavos", () => {
  const result = buildSchedule({ method: "installments", totalCents: 1000000,
    count: 8, installmentCents: 97500, firstDueDate: "2026-11-10",
    entryCents: 200000, entryDueDate: "2026-10-10" });
  assert.equal(result.sumCents, 980000);
  assert.equal(result.differenceCents, 20000);
});

test("somente percentuais permitidos entram no seletor", () => {
  assert.deepEqual(PERCENTAGES, [5,10,15,20,25,30,35,40,45,50,55,60]);
  assert.equal(PERCENTAGES.map(Number).includes(12), false);
});

test("moeda, datas e comissão usam centavos", () => {
  assert.equal(parseMoneyBR("R$ 1.080,00"), 108000);
  assert.equal(parseMoneyBR("1.080,999"), null);
  assert.equal(formatBRL(1234.56).replaceAll("\u00a0", " "), "R$ 1.234,56");
  assert.equal(formatDateBR("2026-10-01"), "01/10/2026");
  assert.equal(participationCents(100000, 40), 40000);
  assert.equal(participationCents(108000, 40), 43200);
  assert.equal(numericToCents("1080.00"), 108000);
});

const contract: ContractRecord = {
  id: "contract-1", client_id: "client-1", client_name: "Cliente Teste",
  client_cpf: "52998224725", origin: "Cliente próprio", contract_date: "2026-10-01",
  total_contract_value: 1000, payment_method: "cash", contract_file_path: null,
  contract_file_name: null, commission_percentage: 40,
  installments: [{ id: "item-1", installment_number: 1, kind: "regular", regular_number: 1,
    due_date: "2026-10-10", contractual_amount: 1000, payments: [
      { id: "payment-1", payment_date: "2026-10-22", amount_paid: 1080,
        commissions: { commission_amount: 432 } },
    ] }],
};

test("advogada sem contratos recebe resumo vazio", () => {
  const result = summarizeContracts([], "2026-10-23");
  assert.equal(result.totalContractedCents, 0);
  assert.equal(result.monthlyGeneratedCents, 0);
  assert.deepEqual(result.rows, []);
});

test("estimativa usa parcela e comissão usa valor pago", () => {
  const result = summarizeContracts([contract], "2026-10-23");
  assert.equal(result.totalContractedCents, 100000);
  assert.equal(result.contractedParticipationCents, 40000);
  assert.equal(result.monthlyEstimateCents, 40000);
  assert.equal(result.monthlyGeneratedCents, 43200);
  assert.equal(result.rows[0].paidCents, 108000);
  assert.equal(result.rows[0].differenceCents, 8000);
  assert.equal(result.rows[0].status, "paid");
});

test("sem pagamento mostra campos nulos e status derivado", () => {
  const unpaid = { ...contract, installments: [{ ...contract.installments[0], payments: [] }] };
  const rows = buildFinancialRows([unpaid], "2026-10-23");
  assert.equal(rows[0].paidCents, null);
  assert.equal(rows[0].commissionCents, null);
  assert.equal(rows[0].status, "overdue");
  assert.equal(installmentStatus(100000, 50000, "2026-10-10", "2026-10-23"), "partial");
});

test("filtros combinam mês, ano, cliente, origem e status", () => {
  const rows = buildFinancialRows([contract], "2026-10-23");
  assert.equal(filterFinancialRows(rows, { month: "10", year: "2026", clientId: "client-1",
    origin: "Cliente próprio", status: "paid" }).length, 1);
  assert.equal(filterFinancialRows(rows, { month: "11", year: "2026", clientId: "",
    origin: "", status: "" }).length, 0);
});
