import { numericToCents } from "@/lib/contracts/finance";
import { followUpReasons } from "@/lib/contracts/follow-up";
import { contractClientLabel } from "@/lib/contracts/parties";
import { closedContractsInMonth } from "@/lib/contracts/engagement";
import { buildWallet, shiftMonth } from "@/lib/contracts/wallet";
import type { ContractRecord } from "@/lib/contracts/view";
import type { Closing, Notification, Transfer } from "@/lib/finance/data";

/** Compare the same elapsed calendar days, clamped at the end of the previous month. */
export function previousComparableDate(today: string) {
  const month = shiftMonth(today.slice(0, 7), -1);
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(today.slice(8)), lastDay)).padStart(2, "0")}`;
}

export function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round((current - previous) / previous * 100) : null;
}

export function buildLawyerOverview(contracts: ContractRecord[], closings: Closing[],
  transfers: Transfer[], notifications: Notification[], today: string) {
  const month = today.slice(0, 7);
  const previousDate = previousComparableDate(today);
  // Future-dated records and voids do not count as money received up to today.
  const snapshot = contracts.map((contract) => ({ ...contract, installments: contract.installments.map((item) => ({
    ...item, payments: item.payments.filter((payment) => payment.payment_date <= today),
  })) }));
  const wallet = buildWallet(snapshot, today, month);
  const unpaid = wallet.rows.filter((row) => row.contractualCents > (row.paidCents ?? 0));
  const dueToday = unpaid.filter((row) => row.dueDate === today);
  const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
  const futureEvents = contracts.filter((contract) => followUpReasons(contract).length > 0);
  const overdue = new Map<string, { contractId: string; clientName: string; service: string | null;
    count: number; balanceCents: number; participationCents: number; oldestDate: string }>();
  for (const row of unpaid.filter((item) => item.dueDate < today)) {
    const entry = overdue.get(row.contractId) ?? { contractId: row.contractId, clientName: row.clientName,
      service: contractMap.get(row.contractId)?.service_name ?? null, count: 0, balanceCents: 0,
      participationCents: 0, oldestDate: row.dueDate };
    entry.count += 1;
    entry.balanceCents += row.contractualCents - (row.paidCents ?? 0);
    entry.participationCents += row.remainingEstimatedCents ?? 0;
    overdue.set(row.contractId, entry);
  }
  // One upcoming installment per contract keeps a long schedule from filling the home page.
  const nextByContract = new Map<string, typeof wallet.rows[number]>();
  for (const row of unpaid.filter((item) => item.dueDate >= today)) {
    if (!nextByContract.has(row.contractId)) nextByContract.set(row.contractId, row);
  }
  const origins = new Map<string, number>();
  let previousGeneratedCents = 0;
  for (const contract of snapshot) for (const item of contract.installments) for (const payment of item.payments) {
    if (payment.voided_at) continue;
    const amount = numericToCents(payment.commissions?.commission_amount ?? 0);
    if (payment.payment_date.startsWith(month)) origins.set(contract.origin, (origins.get(contract.origin) ?? 0) + amount);
    if (payment.payment_date.startsWith(previousDate.slice(0, 7)) && payment.payment_date <= previousDate)
      previousGeneratedCents += amount;
  }
  const previousContractCount = closedContractsInMonth(contracts, previousDate.slice(0, 7), today)
    .filter((contract) => contract.closed_on! <= previousDate).length;
  const confirmedPendingCents = closings.filter((closing) => closing.status !== "draft")
    .reduce((sum, closing) => sum + numericToCents(closing.amount_pending_transfer), 0);
  const transferredThisMonthCents = transfers.filter((transfer) => !transfer.reversed_at &&
    transfer.payment_date.startsWith(month) && transfer.payment_date <= today)
    .reduce((sum, transfer) => sum + numericToCents(transfer.amount), 0);
  return {
    today, month, wallet, previousDate, previousContractCount, previousGeneratedCents,
    commissionChange: percentageChange(wallet.current.generatedCents, previousGeneratedCents),
    activeContractCount: new Set(unpaid.map((row) => row.contractId)).size,
    confirmedPendingCents, transferredThisMonthCents,
    upcoming: [...nextByContract.values()].slice(0, 5).map((row) => ({ ...row,
      service: contractMap.get(row.contractId)?.service_name ?? null })),
    dueTodayCount: dueToday.length,
    overdueContracts: [...overdue.values()].sort((a, b) => a.oldestDate.localeCompare(b.oldestDate)),
    futureEvents: futureEvents.map((contract) => ({ id: contract.id, clientName: contractClientLabel(contract),
      service: contract.service_name ?? null, reasons: followUpReasons(contract) })),
    unreadCount: notifications.filter((notification) => !notification.read_at).length,
    timeline: wallet.timeline.filter((item) => item.month <= month),
    origins: [...origins].filter(([, cents]) => cents > 0).map(([origin, cents]) => ({ origin, cents }))
      .sort((a, b) => b.cents - a.cents),
  };
}

export type LawyerOverview = ReturnType<typeof buildLawyerOverview>;
