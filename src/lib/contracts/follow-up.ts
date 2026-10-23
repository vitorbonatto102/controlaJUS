import type { ContractParty } from "./parties";

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
  clientCpf: string | null; origin: string;
  contractors?: ContractParty[];
  serviceName?: string | null;
  contractDate: string; totalValue: number | null; successFeePercentage: number | null;
  additionalFeePercentage: number | null; additionalFeeBasis: string | null;
  additionalFeeAmount: number | null; paymentCondition: string | null;
};

export type FollowUpFilters = {
  reason: string; lawyerId: string; client: string; cpf: string; origin: string;
  dateFrom: string; dateTo: string; paymentMethod: string; valueStatus: string; terms: string;
};

export const emptyFollowUpFilters: FollowUpFilters = {
  reason: "", lawyerId: "", client: "", cpf: "", origin: "", dateFrom: "", dateTo: "",
  paymentMethod: "", valueStatus: "", terms: "",
};

export function filterFollowUpContracts(contracts: FollowUpContract[], filters: Partial<FollowUpFilters>): FollowUpContract[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const client = normalize(filters.client?.trim() ?? "");
  const cpf = filters.cpf?.replace(/\D/g, "") ?? "";
  const terms = normalize(filters.terms?.trim() ?? "");
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) return [];
  return contracts.filter((contract) => {
    const reasons = followUpReasons(contract);
    return reasons.length > 0 && (!filters.reason || reasons.some((reason) => reason === filters.reason)) &&
      (!filters.lawyerId || contract.lawyerId === filters.lawyerId) &&
      (!client || normalize(contract.clientName).includes(client)) &&
      (!cpf || (contract.contractors?.length ? contract.contractors.map((party) => party.cpf) : [contract.clientCpf])
        .some((value) => (value?.replace(/\D/g, "") ?? "").includes(cpf))) &&
      (!filters.origin || contract.origin === filters.origin) &&
      (!filters.dateFrom || contract.contractDate >= filters.dateFrom) &&
      (!filters.dateTo || contract.contractDate <= filters.dateTo) &&
      (!filters.paymentMethod || contract.payment_method === filters.paymentMethod) &&
      (!filters.valueStatus || (filters.valueStatus === "known" ? contract.totalValue !== null : contract.totalValue === null)) &&
      (!terms || normalize(`${contract.serviceName ?? ""} ${contract.paymentCondition ?? ""} ${contract.additionalFeeBasis ?? ""}`).includes(terms));
  });
}
