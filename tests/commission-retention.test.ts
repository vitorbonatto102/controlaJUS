import assert from "node:assert/strict";
import { test } from "node:test";
import { commissionTargetCents, projectContractCommissions } from "../src/lib/contracts/commission-retention";
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
    successFeePercentage: "30", commissionMode: "upfront" as const, commissionLimit: "750,00" };
  const preview = prepareContract(form);
  assert.equal(preview.commissionLimitCents, 75000);
  assert.equal(preview.totalCents, null);
  assert.equal(preview.percentage, 5);
  assert.deepEqual(preview.rows, []);
  for (const invalid of ["", "0", "-100", "abc"])
    assert.throws(() => prepareContract({ ...form, commissionLimit: invalid }), /limite total/);
});
