export const engagementLabels = {
  unconfirmed: "Aguardando confirmação",
  confirmed: "Contratação confirmada",
  cancelled: "Contratação cancelada",
} as const;
export type EngagementStatus = keyof typeof engagementLabels;
export type EngagementFields = { engagement_status?: EngagementStatus; closed_on?: string | null };
export type ContractEngagement = EngagementFields & { id: string; updated_at: string };

export function isConfirmedContract(contract: EngagementFields, today: string): boolean {
  return contract.engagement_status === "confirmed" && !!contract.closed_on && contract.closed_on <= today;
}

export function closedContractsInMonth<T extends EngagementFields & { id: string }>(contracts: T[], month: string, today: string): T[] {
  const unique = new Map(contracts.filter((contract) => isConfirmedContract(contract, today) &&
    contract.closed_on!.startsWith(month)).map((contract) => [contract.id, contract]));
  return [...unique.values()];
}
