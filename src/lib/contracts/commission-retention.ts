import { numericToCents, participationCents } from "./finance";

export type CommissionMode = "proportional" | "upfront";
export const commissionModeLabels: Record<CommissionMode, string> = {
  proportional: "Proporcionalmente em todas as parcelas",
  upfront: "Nas primeiras parcelas, até quitar a participação",
};

export type CommissionTerms = {
  commission_percentage: number;
  commission_mode?: CommissionMode;
  commission_upfront_limit?: number | null;
  total_contract_value: number | null;
  commercial_percentage?: number;
  third_party_upfront_limit?: number | null;
};

export function commissionTargetCents(terms: CommissionTerms): number | null {
  if (terms.commission_mode === "upfront" && terms.commission_upfront_limit != null)
    return numericToCents(terms.commission_upfront_limit);
  return terms.total_contract_value === null ? null :
    participationCents(numericToCents(terms.total_contract_value), terms.commission_percentage);
}

function roundedRatio(amount: number, numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const product = BigInt(amount) * BigInt(numerator), divisor = BigInt(denominator);
  const result = Number((product * BigInt(2) + divisor) / (divisor * BigInt(2)));
  if (!Number.isSafeInteger(result)) throw new Error("Limite de comissão fora da precisão permitida.");
  return result;
}

export function commercialTargetCents(terms: CommissionTerms): number | null {
  if (terms.commission_mode === "upfront" && terms.third_party_upfront_limit != null)
    return numericToCents(terms.third_party_upfront_limit);
  const commercial = terms.commercial_percentage ?? 0;
  if (commercial === 0) return 0;
  if (terms.commission_mode === "upfront" && terms.commission_upfront_limit != null)
    return roundedRatio(numericToCents(terms.commission_upfront_limit), commercial, terms.commission_percentage);
  return terms.total_contract_value === null ? null : participationCents(numericToCents(terms.total_contract_value), commercial);
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
  const shared = upfront && ((terms.commercial_percentage ?? 0) > 0 || (terms.third_party_upfront_limit ?? 0) > 0);
  const combinedTarget = (target ?? 0) + (shared ? commercialTargetCents(terms) ?? 0 : 0);
  const cumulativeShare = (cash: number) => roundedRatio(Math.min(cash, combinedTarget), target ?? 0, combinedTarget);
  let forecastCash = 0;
  let remainingCash = items.reduce((sum, item) => sum + item.paidCents, 0);
  const ordered = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate) ||
    a.order - b.order || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const balance = Math.max(0, item.contractualCents - item.paidCents);
    const share = (cash: number, amount: number) => cumulativeShare(cash + amount) - cumulativeShare(cash);
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
