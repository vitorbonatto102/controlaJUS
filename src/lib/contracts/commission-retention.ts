import { numericToCents, participationCents } from "./finance";

export type CommissionMode = "proportional" | "upfront";
export const commissionModeLabels: Record<CommissionMode, string> = {
  proportional: "Retenção proporcional em cada parcela",
  upfront: "Retenção total no primeiro acerto",
};

export type CommissionTerms = {
  commission_percentage: number;
  commission_mode?: CommissionMode;
  commission_upfront_limit?: number | null;
  total_contract_value: number | null;
  commercial_percentage?: number;
};

export function commissionTargetCents(terms: CommissionTerms): number | null {
  if (terms.commission_mode === "upfront" && terms.commission_upfront_limit != null)
    return numericToCents(terms.commission_upfront_limit);
  return terms.total_contract_value === null ? null :
    participationCents(numericToCents(terms.total_contract_value), terms.commission_percentage);
}

type ProjectionItem = { id: string; dueDate: string; order: number; contractualCents: number; paidCents: number };
export type CommissionProjection = { estimatedCents: number; remainingEstimatedCents: number };

/** Contractual forecast and remaining forecast are distinct from persisted commissions. */
export function projectContractCommissions(items: ProjectionItem[], terms: CommissionTerms, generatedCents: number) {
  const result = new Map<string, CommissionProjection>();
  const upfront = terms.commission_mode === "upfront";
  const target = commissionTargetCents(terms);
  if (upfront && target === null) throw new Error("Contrato com retenção total sem limite de comissão definido.");
  let forecastBudget = target ?? 0;
  let remainingBudget = Math.max(0, forecastBudget - generatedCents);
  const shared = upfront && (terms.commercial_percentage ?? 0) > 0;
  let forecastCash = 0;
  let remainingCash = items.reduce((sum, item) => sum + item.paidCents, 0);
  const ordered = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate) ||
    a.order - b.order || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const balance = Math.max(0, item.contractualCents - item.paidCents);
    const share = (cash: number, amount: number) => Math.round(Math.min(cash + amount, (target ?? 0) * 2) / 2) - Math.round(Math.min(cash, (target ?? 0) * 2) / 2);
    const estimatedCents = upfront ? Math.min(forecastBudget, shared ? share(forecastCash, item.contractualCents) : item.contractualCents) :
      participationCents(item.contractualCents, terms.commission_percentage);
    const remainingEstimatedCents = upfront ? Math.min(remainingBudget, shared ? share(remainingCash, balance) : balance) :
      participationCents(balance, terms.commission_percentage);
    forecastBudget -= upfront ? estimatedCents : 0;
    remainingBudget -= upfront ? remainingEstimatedCents : 0;
    forecastCash += item.contractualCents;
    remainingCash += balance;
    result.set(item.id, { estimatedCents, remainingEstimatedCents });
  }
  return result;
}
