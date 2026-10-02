import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManagerPaymentRows, filterManagerRows, managerDelinquency,
  managerTotals } from "../src/lib/manager/view";
import type { ManagerWorkspace } from "../src/lib/manager/data";

const data: ManagerWorkspace = {
  lawyers: [
    { id: "lawyer-a", full_name: "Advogada A", active: true },
    { id: "lawyer-b", full_name: "Advogada B", active: true },
  ],
  users: [], notes: [], terms: [
    { contract_id: "contract-a", commission_percentage: 40 },
    { contract_id: "contract-b", commission_percentage: 20 },
  ],
  contractTotals: [], closings: [], items: [], transfers: [], adjustments: [], audit: [],
  commissions: [
    { id: "c1", payment_id: "p1", lawyer_id: "lawyer-a", commission_percentage: 40, commission_amount: 240 },
    { id: "c2", payment_id: "p2", lawyer_id: "lawyer-a", commission_percentage: 40, commission_amount: 192 },
    { id: "c3", payment_id: "p3", lawyer_id: "lawyer-a", commission_percentage: 40, commission_amount: 40 },
  ],
  contracts: [
    {
      id: "contract-a", client_id: "client-a", client_name: "Cliente A", client_cpf: null,
      lawyer_id: "lawyer-a", lawyer_name: "Advogada A", origin: "Cliente próprio", contract_date: "2024-08-01",
      installments: [{ id: "installment-a", contract_id: "contract-a", installment_number: 1,
        kind: "regular", regular_number: 1, due_date: "2024-09-10", contractual_amount: 1000,
        payments: [
          { id: "p1", installment_id: "installment-a", payment_date: "2024-09-30", amount_paid: 600,
            recorded_by: "secretary", created_at: "2024-09-30T12:00:00Z", observation: null,
            voided_at: null, void_reason: null, replaces_payment_id: null },
          { id: "p2", installment_id: "installment-a", payment_date: "2024-09-30", amount_paid: 480,
            recorded_by: "secretary", created_at: "2024-09-30T13:00:00Z", observation: null,
            voided_at: null, void_reason: null, replaces_payment_id: null },
          { id: "p3", installment_id: "installment-a", payment_date: "2024-10-01", amount_paid: 100,
            recorded_by: "secretary", created_at: "2024-10-01T12:00:00Z", observation: null,
            voided_at: null, void_reason: null, replaces_payment_id: null },
        ],
      }],
    },
    {
      id: "contract-b", client_id: "client-b", client_name: "Cliente B", client_cpf: null,
      lawyer_id: "lawyer-b", lawyer_name: "Advogada B", origin: "Tráfego HP", contract_date: "2024-08-01",
      installments: [{ id: "installment-b", contract_id: "contract-b", installment_number: 1,
        kind: "regular", regular_number: 1, due_date: "2024-09-05", contractual_amount: 500,
        payments: [],
      }],
    },
  ],
};

test("gestor soma recebimentos por data efetiva e filtra advogada, mês e cliente", () => {
  const rows = buildManagerPaymentRows(data, "2024-10-05");
  assert.equal(rows.length, 3);
  const september = filterManagerRows(rows, { lawyerId: "lawyer-a", month: "09", year: "2024",
    client: "Cliente A", origin: "Cliente próprio", status: "" });
  assert.equal(september.length, 2);
  assert.deepEqual(managerTotals(september, 20000), {
    receivedCents: 108000, commissionCents: 43200, transferredCents: 20000,
    pendingCents: 23200, clientCount: 1,
  });
  const october = filterManagerRows(rows, { lawyerId: "lawyer-a", month: "10", year: "2024",
    client: "", origin: "", status: "" });
  assert.equal(october.length, 1);
  assert.equal(managerTotals(october, 0).commissionCents, 4000);
  assert.equal(filterManagerRows(rows, { lawyerId: "lawyer-b", month: "09", year: "2024",
    client: "", origin: "", status: "" }).length, 0);
});

test("inadimplência usa somente saldo contratual vencido como potencial", () => {
  const rows = managerDelinquency(data, "2024-10-05");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clientName, "Cliente B");
  assert.equal(rows[0].balanceCents, 50000);
  assert.equal(rows[0].potentialCents, 10000);
  assert.equal(managerDelinquency(data, "2024-10-05", { month: "10", year: "2024" }).length, 0);
  assert.equal(managerDelinquency(data, "2024-10-05", { month: "09", year: "2024",
    lawyerId: "lawyer-b", client: "Cliente B" }).length, 1);
});
