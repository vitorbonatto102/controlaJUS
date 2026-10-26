import { numericToCents, participationCents } from "./finance";
import { buildFinancialRows, type ContractRecord, type FinancialRow } from "./view";
import { commissionTargetCents } from "./commission-retention";

export type WalletTransfer = {
  id: string;
  amount: number;
  payment_date: string;
  reversed_at: string | null;
};

export type WalletMonth = {
  month: string;
  contractualCents: number;
  estimatedCents: number;
  receivedCents: number;
  generatedCents: number;
  remainingCents: number;
  remainingParticipationCents: number;
};

export const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Calendar arithmetic on ISO month keys avoids browser timezone and day-of-month shifts.
export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + number - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string, short = false): string {
  const [year, number] = month.split("-");
  const name = monthNames[Number(number) - 1];
  return `${short ? name.slice(0, 3) : name} / ${year}`;
}

export function filterWalletRows(rows: FinancialRow[], filters: {
  referenceMonth: string; allPeriods: boolean; status: string; dueDate: string;
}, today: string) {
  return rows.filter((row) => (filters.allPeriods || row.dueDate.startsWith(filters.referenceMonth)) &&
    (!filters.dueDate || row.dueDate === filters.dueDate) &&
    (!filters.status || (filters.status === "delinquent"
      ? row.dueDate < today && row.contractualCents > (row.paidCents ?? 0)
      : row.status === filters.status)));
}

function emptyMonth(month: string): WalletMonth {
  return { month, contractualCents: 0, estimatedCents: 0, receivedCents: 0,
    generatedCents: 0, remainingCents: 0, remainingParticipationCents: 0 };
}

/** Actual commissions come from the payment's persisted commission, never a new estimate. */
export function walletBalance(contracts: ContractRecord[], transfers: WalletTransfer[]) {
  const generatedCents = contracts.reduce((sum, contract) => sum + contract.installments.reduce(
    (subtotal, installment) => subtotal + installment.payments.filter((payment) => !payment.voided_at)
      .reduce((paid, payment) => paid + numericToCents(payment.commissions?.commission_amount ?? 0), 0), 0), 0);
  const transferredCents = transfers.filter((transfer) => !transfer.reversed_at)
    .reduce((sum, transfer) => sum + numericToCents(transfer.amount), 0);
  // A negative balance is an excess transfer to regularize, not a negative receivable.
  return { generatedCents, transferredCents, pendingCents: Math.max(0, generatedCents - transferredCents),
    overpaidCents: Math.max(0, transferredCents - generatedCents) };
}

export function buildWallet(contracts: ContractRecord[], today: string, referenceMonth: string) {
  const rows = buildFinancialRows(contracts, today);
  const months = new Map<string, WalletMonth>();
  const getMonth = (key: string) => {
    if (!months.has(key)) months.set(key, emptyMonth(key));
    return months.get(key)!;
  };
  let overdueCents = 0;
  let overdueParticipationCents = 0;
  let overdueCount = 0;
  for (const row of rows) {
    const month = getMonth(row.dueDate.slice(0, 7));
    const remaining = Math.max(0, row.contractualCents - (row.paidCents ?? 0));
    const participation = row.remainingEstimatedCents ?? participationCents(remaining, row.percentage);
    month.contractualCents += row.contractualCents;
    month.estimatedCents += row.estimatedCents;
    month.remainingCents += remaining;
    month.remainingParticipationCents += participation;
    if (row.dueDate < today && remaining > 0) {
      overdueCents += remaining;
      overdueParticipationCents += participation;
      overdueCount += 1;
    }
  }
  let missingCommissionCount = 0;
  // Payments on the same installment may belong to different months. Aggregate each one.
  for (const contract of contracts) for (const installment of contract.installments) {
    for (const payment of installment.payments) {
      if (payment.voided_at) continue;
      const month = getMonth(payment.payment_date.slice(0, 7));
      month.receivedCents += numericToCents(payment.amount_paid);
      month.generatedCents += numericToCents(payment.commissions?.commission_amount ?? 0);
      if (!payment.commissions) missingCommissionCount += 1;
    }
  }
  const byOrigin = new Map<string, number>();
  let totalContractedCents = 0;
  let contractedParticipationCents = 0;
  for (const contract of contracts) {
    const value = contract.total_contract_value === null ? 0 : numericToCents(contract.total_contract_value);
    const participation = commissionTargetCents(contract) ?? 0;
    totalContractedCents += value;
    contractedParticipationCents += participation;
    byOrigin.set(contract.origin, (byOrigin.get(contract.origin) ?? 0) + participation);
  }
  const previousMonth = shiftMonth(referenceMonth, -1);
  const currentContractCount = contracts.filter((contract) =>
    contract.contract_date.startsWith(referenceMonth) && contract.contract_date <= today).length;
  const previousContracts = contracts.filter((contract) =>
    contract.contract_date.startsWith(previousMonth) && contract.contract_date <= today);
  return {
    rows, totalContractedCents, contractedParticipationCents, missingCommissionCount, currentContractCount,
    previousMonth, previousContractCount: previousContracts.length,
    previousContractedCents: previousContracts.reduce((sum, contract) => sum +
      (contract.total_contract_value === null ? 0 : numericToCents(contract.total_contract_value)), 0),
    previousUnknownCount: previousContracts.filter((contract) => contract.total_contract_value === null).length,
    current: getMonth(referenceMonth), next: getMonth(shiftMonth(referenceMonth, 1)),
    // Five past months, the reference month and six months ahead.
    timeline: Array.from({ length: 12 }, (_, index) => getMonth(shiftMonth(referenceMonth, index - 5))),
    outlook: Array.from({ length: 6 }, (_, index) => getMonth(shiftMonth(referenceMonth, index + 1))),
    origins: [...byOrigin].map(([origin, cents]) => ({ origin, cents })).sort((a, b) => b.cents - a.cents),
    overdueCents, overdueParticipationCents, overdueCount,
    receivedCents: [...months.values()].reduce((sum, month) => sum + month.receivedCents, 0),
  };
}
