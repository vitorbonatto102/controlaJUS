import { numericToCents, participationCents } from "./finance";

export type PaymentRecord = {
  id: string;
  payment_date: string;
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
export type ContractRecord = {
  id: string;
  client_id: string;
  client_name: string;
  client_cpf: string | null;
  origin: string;
  contract_date: string;
  total_contract_value: number;
  payment_method: "cash" | "installments" | null;
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
    const regularCount = contract.installments.filter((item) => item.kind === "regular").length;
    return contract.installments.map((item) => {
      const contractualCents = numericToCents(item.contractual_amount);
      const activePayments = item.payments.filter((payment) => !payment.voided_at);
      const paidCents = activePayments.reduce((sum, payment) => sum + numericToCents(payment.amount_paid), 0);
      const commissionCents = activePayments.reduce((sum, payment) => sum + (
        payment.commissions ? numericToCents(payment.commissions.commission_amount) :
          participationCents(numericToCents(payment.amount_paid), contract.commission_percentage)
      ), 0);
      const latestPaymentDate = activePayments.reduce<string | null>((latest, payment) =>
        !latest || payment.payment_date > latest ? payment.payment_date : latest, null);
      return {
        contractId: contract.id, clientId: contract.client_id, clientName: contract.client_name,
        origin: contract.origin, installmentId: item.id,
        installmentLabel: installmentLabel(item, regularCount), dueDate: item.due_date,
        contractualCents, paidCents: activePayments.length ? paidCents : null,
        differenceCents: activePayments.length ? paidCents - contractualCents : null,
        latestPaymentDate, percentage: contract.commission_percentage,
        estimatedCents: participationCents(contractualCents, contract.commission_percentage),
        commissionCents: activePayments.length ? commissionCents : null,
        status: installmentStatus(contractualCents, paidCents, item.due_date, today),
      };
    });
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName));
}

export function summarizeContracts(contracts: ContractRecord[], today: string) {
  const month = today.slice(0, 7);
  const rows = buildFinancialRows(contracts, today);
  return {
    totalContractedCents: contracts.reduce((sum, contract) => sum + numericToCents(contract.total_contract_value), 0),
    contractedParticipationCents: contracts.reduce((sum, contract) => sum + participationCents(
      numericToCents(contract.total_contract_value), contract.commission_percentage), 0),
    monthlyEstimateCents: rows.filter((row) => row.dueDate.startsWith(month))
      .reduce((sum, row) => sum + row.estimatedCents, 0),
    monthlyGeneratedCents: contracts.reduce((sum, contract) => sum + contract.installments.reduce(
      (itemSum, item) => itemSum + item.payments.filter((payment) => !payment.voided_at && payment.payment_date.startsWith(month))
        .reduce((paymentSum, payment) => paymentSum + (
          payment.commissions ? numericToCents(payment.commissions.commission_amount) :
            participationCents(numericToCents(payment.amount_paid), contract.commission_percentage)
        ), 0), 0), 0),
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
