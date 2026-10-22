export const followUpLabels = {
  success_only: "Apenas no êxito",
  additional_fee: "Honorários adicionais / proveito econômico",
  condition: "Início condicionado",
} as const;
export type FollowUpReason = keyof typeof followUpLabels;
export type FollowUpTerms = {
  payment_method: string | null;
  has_additional_fee?: boolean;
  payment_start_type?: string | null;
};

export function followUpReasons(contract: FollowUpTerms): FollowUpReason[] {
  const reasons: FollowUpReason[] = [];
  if (contract.payment_method === "success_only") reasons.push("success_only");
  if (contract.has_additional_fee) reasons.push("additional_fee");
  if (contract.payment_start_type === "condition") reasons.push("condition");
  return reasons;
}

// Somente dados operacionais: não inclui participação ou comissões da advogada.
export type FollowUpContract = FollowUpTerms & {
  id: string; clientId: string; clientName: string; lawyerId: string; lawyerName: string;
  contractDate: string; totalValue: number | null; successFeePercentage: number | null;
  additionalFeePercentage: number | null; additionalFeeBasis: string | null;
  additionalFeeAmount: number | null; paymentCondition: string | null;
};

export function filterFollowUpContracts(contracts: FollowUpContract[], filters: {
  reason: string; lawyerId: string; client: string;
}): FollowUpContract[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const client = normalize(filters.client.trim());
  return contracts.filter((contract) => {
    const reasons = followUpReasons(contract);
    return reasons.length > 0 && (!filters.reason || reasons.some((reason) => reason === filters.reason)) &&
      (!filters.lawyerId || contract.lawyerId === filters.lawyerId) &&
      (!client || normalize(contract.clientName).includes(client));
  });
}
