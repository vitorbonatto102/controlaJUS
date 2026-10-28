import assert from "node:assert/strict";
import { test } from "node:test";
import { closedContractsInMonth } from "../src/lib/contracts/engagement";
import { contractGoalProgress } from "../src/lib/dashboard/goals";
import { goalEvolution, validGoalMonth, type GoalSummary } from "../src/lib/goals/model";

test("contagem comercial exclui cadastros, cancelamentos e datas futuras; deduplica por contrato", () => {
  const signed = { id: "one", engagement_status: "confirmed" as const, closed_on: "2026-10-05" };
  assert.deepEqual(closedContractsInMonth([signed, signed,
    { id: "legacy", contract_date: "2026-10-01" },
    { ...signed, id: "future", closed_on: "2026-10-30" },
    { ...signed, id: "cancelled", engagement_status: "cancelled" as const, closed_on: null },
    { ...signed, id: "old", closed_on: "2026-09-30" },
  ], "2026-10", "2026-10-28"), [signed]);
  assert.equal(contractGoalProgress(199, 200).percentage, 99, "100% só após atingir o objetivo");
});

test("evolução separa realizado, projeção e histórico; calendário respeita virada do ano e fevereiro", () => {
  const summary: GoalSummary = { month: "2027-01", scope: "individual", count: 6, previous_count: 4,
    previous_until: "2026-12-28", comparison_available: true, best_previous_count: 5, pending_count: 0,
    as_of: "2027-01-28", goal_updated_at: null, history: [
      { month: "2026-10", count: 3, target: null, has_history: true },
      { month: "2026-11", count: 0, target: 5, has_history: true },
      { month: "2026-12", count: 5, target: 5, has_history: true },
      { month: "2027-01", count: 6, target: 10, has_history: true },
    ] };
  const view = goalEvolution(summary, "2027-01-28");
  assert.equal(view.average, 8/3); assert.equal(view.difference, 2); assert.equal(view.newRecord, true);
  assert.equal(view.daysRemaining, 3); assert.equal(view.requiredPerDay, 4/3); assert.equal(view.milestone, 50);
  assert.equal(view.projection, 6);
  assert.equal(goalEvolution({ ...summary, history: summary.history.slice(1) }, "2027-01-28").average, null);
  assert.equal(goalEvolution(summary, "2027-02-01").projection, null, "período encerrado sem projeção");
  assert.equal(goalEvolution({ ...summary, month: "2028-02" }, "2028-02-28").daysRemaining, 1);
  assert.equal(goalEvolution({ ...summary, month: "2027-02" }, "2027-02-28").daysRemaining, 0);
  assert.equal(validGoalMonth("2027-13", "2027-01"), false);
  assert.equal(validGoalMonth("2027-02", "2027-01"), false);
  assert.equal(validGoalMonth("2026-12", "2027-01"), true);
});
