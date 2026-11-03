export const engagementLabels = {
  unconfirmed: "Aguardando confirmação",
  confirmed: "Contratação confirmada",
  cancelled: "Contratação cancelada",
} as const;
export type EngagementStatus = keyof typeof engagementLabels;
export type EngagementFields = { engagement_status?: EngagementStatus; closed_on?: string | null };
export type ContractEngagement = EngagementFields & { id: string; updated_at: string };

// Metas e indicadores comerciais usam a data da contratação no documento.
// A confirmação separada permanece apenas como histórico da contratação.
export function closedContractsInMonth<T extends EngagementFields & { id: string; contract_date?: string | null; deleted_at?: string | null }>(contracts: T[], month: string, today: string): T[] {
  const unique = new Map(contracts.filter((contract) => contract.engagement_status !== "cancelled" && !contract.deleted_at &&
    !!contract.contract_date && contract.contract_date <= today && contract.contract_date.startsWith(`${month}-`))
    .map((contract) => [contract.id, contract]));
  return [...unique.values()];
}
