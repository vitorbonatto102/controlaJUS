import { numericToCents } from "./finance";
import { contractClientLabel, type ContractParty } from "./parties";
import { commercialTargetCents, commissionTargetCents, projectContractCommissions, type CommissionMode } from "./commission-retention";
import type { EngagementFields } from "./engagement";
import type { InstallmentGroup } from "./installment-groups";

export type PaymentRecord = {
  id: string;
  payment_date: string;
  created_at?: string;
  amount_paid: number;
  voided_at?: string | null;
  commissions: { commission_amount: number } | null;
};
export type InstallmentRecord = {
  id: string;
  installment_number: number;
  kind: "down_payment" | "regular";
  regular_number: number | null;
  due_date: string;
  contractual_amount: number;
  payments: PaymentRecord[];
};
export type ContractRecord = EngagementFields & {
  id: string;
  client_id: string;
  client_name: string;
  client_cpf: string | null;
  contractors?: ContractParty[];
  service_name?: string | null;
  origin: string;
  contract_date: string;
  total_contract_value: number | null;
  payment_method: "cash" | "installments" | "success_only" | null;
  success_fee_percentage?: number | null;
  contract_file_path: string | null;
  contract_file_name: string | null;
  payment_start_type?: "fixed_date" | "condition" | null;
  first_due_date?: string | null;
  payment_start_condition?: string | null;
  last_installment_amount?: number | null;
  has_additional_fee?: boolean;
  additional_fee_percentage?: number | null;
  additional_fee_basis?: string | null;
  additional_fee_amount?: number | null;
  commission_percentage: number;
  commercial_percentage?: number;
  commercial_recipient_name?: string | null;
  upfront_distribution?: "lawyer_only" | "shared" | null;
  third_party_upfront_limit?: number | null;
  payout_day?: number;
  first_payout_date?: string | null;
  commission_mode?: CommissionMode;
  commission_upfront_limit?: number | null;
  updated_at?: string;
  installment_count?: number | null;
  installment_groups?: InstallmentGroup[];
  installment_amount?: number | null;
  installments: InstallmentRecord[];
};
export type InstallmentStatus = "upcoming" | "overdue" | "partial" | "paid";
export type FinancialRow = {
  contractId: string;
  clientId: string;
  clientName: string;
  origin: string;
  installmentId: string;
  installmentLabel: string;
  dueDate: string;
  contractualCents: number;
  paidCents: number | null;
  differenceCents: number | null;
  latestPaymentDate: string | null;
  percentage: number;
  estimatedCents: number;
  thirdPartyEstimatedCents?: number;
  thirdPartyRemainingCents?: number;
  officeEstimatedCents?: number;
  thirdPartyName?: string | null;
  remainingEstimatedCents?: number;
  commissionMode?: CommissionMode;
  commissionCents: number | null;
  status: InstallmentStatus;
};

export const statusLabels: Record<InstallmentStatus, string> = {
  upcoming: "A vencer", overdue: "Vencida", partial: "Parcialmente paga", paid: "Paga",
};

export function todayInSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function installmentStatus(contractualCents: number, paidCents: number, dueDate: string,
  today: string): InstallmentStatus {
  if (paidCents > 0 && paidCents >= contractualCents) return "paid";
  if (paidCents > 0) return "partial";
  return dueDate < today ? "overdue" : "upcoming";
}

export function installmentLabel(item: InstallmentRecord, regularCount: number): string {
  return item.kind === "down_payment" ? "Entrada" : `${item.regular_number ?? item.installment_number}/${regularCount}`;
}

export function buildFinancialRows(contracts: ContractRecord[], today: string): FinancialRow[] {
  return contracts.flatMap((contract) => {
    if (contract.payment_method === "success_only") return [];
    const regularCount = contract.installments.filter((item) => item.kind === "regular").length;
    const generatedCents = contract.installments.reduce((total, item) => total + item.payments
      .filter((payment) => !payment.voided_at).reduce((sum, payment) =>
        sum + numericToCents(payment.commissions?.commission_amount ?? 0), 0), 0);
    const projection = projectContractCommissions(contract.installments.map((item) => ({
      id: item.id, dueDate: item.due_date, order: item.installment_number,
      contractualCents: numericToCents(item.contractual_amount),
      paidCents: item.payments.filter((payment) => !payment.voided_at)
        .reduce((sum, payment) => sum + numericToCents(payment.amount_paid), 0),
    })), contract, generatedCents);
    return contract.installments.map((item) => {
      const contractualCents = numericToCents(item.contractual_amount);
      const activePayments = item.payments.filter((payment) => !payment.voided_at);
      const paidCents = activePayments.reduce((sum, payment) => sum + numericToCents(payment.amount_paid), 0);
      const hasCommission = activePayments.some((payment) => payment.commissions !== null);
      const commissionCents = activePayments.reduce((sum, payment) => sum +
        numericToCents(payment.commissions?.commission_amount ?? 0), 0);
      const latestPaymentDate = activePayments.reduce<string | null>((latest, payment) =>
        !latest || payment.payment_date > latest ? payment.payment_date : latest, null);
      return {
        contractId: contract.id, clientId: contract.client_id, clientName: contractClientLabel(contract),
        origin: contract.origin, installmentId: item.id,
        installmentLabel: installmentLabel(item, regularCount), dueDate: item.due_date,
        contractualCents, paidCents: activePayments.length ? paidCents : null,
        differenceCents: activePayments.length ? paidCents - contractualCents : null,
        latestPaymentDate, percentage: contract.commission_percentage,
        ...projection.get(item.id)!, thirdPartyName:contract.commercial_recipient_name, commissionMode: contract.commission_mode ?? "proportional",
        commissionCents: hasCommission ? commissionCents : null,
        status: installmentStatus(contractualCents, paidCents, item.due_date, today),
      };
    });
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName));
}

/** Personal control preserves participating receipts; the office schedule stays intact. */
export function buildLawyerFinancialRows(contracts:ContractRecord[],today:string):FinancialRow[] {
  const rows=buildFinancialRows(contracts,today);
  const relevantPayments=new Set<string>();
  for(const contract of contracts.filter(item=>item.commission_mode==="upfront")){
    const target=(commissionTargetCents(contract)??0)+(commercialTargetCents(contract)??0);
    let cash=0;
    const payments=contract.installments.flatMap(item=>item.payments.filter(p=>!p.voided_at).map(p=>({...p,installmentId:item.id})))
      .sort((a,b)=>a.payment_date.localeCompare(b.payment_date)||(a.created_at??"").localeCompare(b.created_at??"")||a.id.localeCompare(b.id));
    for(const payment of payments){
      if(cash<target || payment.commissions===null || numericToCents(payment.commissions.commission_amount)>0)relevantPayments.add(payment.installmentId);
      cash+=numericToCents(payment.amount_paid);
    }
  }
  return rows.filter(row=>row.commissionMode!=="upfront" || (row.remainingEstimatedCents??0)>0 || (row.thirdPartyRemainingCents??0)>0 ||
    (row.commissionCents??0)>0 || relevantPayments.has(row.installmentId));
}

export function hasPendingContractParticipation(contract:ContractRecord,today:string):boolean {
  if(contract.commission_mode!=="upfront")return true;
  const target=commissionTargetCents(contract);
  if(target===null)return true;
  const payments=contract.installments.flatMap(item=>item.payments.filter(p=>!p.voided_at&&p.payment_date<=today));
  if(payments.some(p=>p.commissions===null))return true;
  const generated=payments.reduce((sum,p)=>sum+numericToCents(p.commissions!.commission_amount),0);
  const received=payments.reduce((sum,p)=>sum+numericToCents(p.amount_paid),0);
  return generated<target||received<target+(commercialTargetCents(contract)??0);
}

export function summarizeContracts(contracts: ContractRecord[], today: string) {
  const month = today.slice(0, 7);
  const rows = buildLawyerFinancialRows(contracts, today);
  const activeContractIds = new Set(rows
    .filter((row) => row.contractualCents > (row.paidCents ?? 0) && (row.commissionMode!=="upfront" || (row.remainingEstimatedCents??0)>0 || (row.thirdPartyRemainingCents??0)>0))
    .map((row) => row.contractId));
  return {
    activeContractCount: activeContractIds.size,
    totalContractedCents: contracts.reduce((sum, contract) => contract.total_contract_value === null ? sum : sum + numericToCents(contract.total_contract_value), 0),
    contractedParticipationCents: contracts.reduce((sum, contract) => sum + (commissionTargetCents(contract) ?? 0), 0),
    monthlyEstimateCents: rows.filter((row) => row.dueDate.startsWith(month))
      .reduce((sum, row) => sum + row.estimatedCents, 0),
    monthlyGeneratedCents: contracts.reduce((sum, contract) => sum + contract.installments.reduce(
      (itemSum, item) => itemSum + item.payments.filter((payment) => !payment.voided_at && payment.payment_date.startsWith(month))
        .reduce((paymentSum, payment) => paymentSum +
          numericToCents(payment.commissions?.commission_amount ?? 0), 0), 0), 0),
    rows,
  };
}

export type TableFilters = { month: string; year: string; clientId: string; origin: string; status: string };

export function filterFinancialRows(rows: FinancialRow[], filters: TableFilters): FinancialRow[] {
  return rows.filter((row) =>
    (!filters.month || row.dueDate.slice(5, 7) === filters.month) &&
    (!filters.year || row.dueDate.slice(0, 4) === filters.year) &&
    (!filters.clientId || row.clientId === filters.clientId) &&
    (!filters.origin || row.origin === filters.origin) &&
    (!filters.status || row.status === filters.status));
}
