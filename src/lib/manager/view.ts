import { numericToCents } from "@/lib/contracts/finance";
import { contractClientLabel, getContractParties } from "@/lib/contracts/parties";
import { buildOperationalRows } from "@/lib/secretary/view";
import type { ManagerWorkspace } from "./data";
import { projectContractCommissions, type CommissionMode } from "@/lib/contracts/commission-retention";

export type ManagerPaymentRow = {
  paymentId: string; contractId: string; clientId: string; clientName: string;
  lawyerId: string; lawyerName: string; origin: string; installmentId: string;
  installmentLabel: string; dueDate: string; contractualCents: number;
  paidCents: number; paymentDate: string; percentage: number; commissionCents: number;
  status: string; corrected: boolean; replacesPaymentId: string | null;
  clientIds?: string[];
  commissionMode?: CommissionMode;
};

export function buildManagerPaymentRows(data: ManagerWorkspace, today: string): ManagerPaymentRow[] {
  const commissionByPayment = new Map(data.commissions.map((item) => [item.payment_id, item]));
  const corrections = new Set(data.audit.filter((item) => item.table_name === "payments")
    .map((item) => item.record_id));
  const operational = new Map(buildOperationalRows(data.contracts, data.notes, today)
    .map((row) => [row.installmentId, row]));
  return data.contracts.flatMap((contract) => contract.installments.flatMap((installment) => {
    const installmentRow = operational.get(installment.id);
    if (!installmentRow) return [];
    return installment.payments.filter((payment) => !payment.voided_at).map((payment) => {
      const commission = commissionByPayment.get(payment.id);
      if (!commission) throw new Error("Pagamento sem comissão gerada.");
      return {
        paymentId: payment.id, contractId: contract.id, clientId: contract.client_id,
        clientName: contractClientLabel(contract), clientIds: getContractParties(contract).map((party) => party.clientId), lawyerId: contract.lawyer_id,
        lawyerName: contract.lawyer_name, origin: contract.origin, installmentId: installment.id,
        installmentLabel: installmentRow.installmentLabel, dueDate: installment.due_date,
        contractualCents: numericToCents(installment.contractual_amount),
        paidCents: numericToCents(payment.amount_paid), paymentDate: payment.payment_date,
        percentage: commission.commission_percentage,
        commissionCents: numericToCents(commission.commission_amount),
        status: installmentRow.status,
        corrected: Boolean(payment.replaces_payment_id || corrections.has(payment.id)),
        replacesPaymentId: payment.replaces_payment_id,
        commissionMode: data.terms.find((term) => term.contract_id === contract.id)?.commission_mode ?? "proportional",
      };
    });
  })).sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

export type ManagerFilters = {
  lawyerId: string; month: string; year: string; client: string; origin: string; status: string;
};

export function filterManagerRows(rows: ManagerPaymentRow[], filters: ManagerFilters) {
  return rows.filter((row) =>
    (!filters.lawyerId || row.lawyerId === filters.lawyerId) &&
    (!filters.month || row.paymentDate.slice(5, 7) === filters.month) &&
    (!filters.year || row.paymentDate.slice(0, 4) === filters.year) &&
    (!filters.client || row.clientName.toLocaleLowerCase("pt-BR")
      .includes(filters.client.toLocaleLowerCase("pt-BR"))) &&
    (!filters.origin || row.origin === filters.origin) &&
    (!filters.status || row.status === filters.status));
}

export function managerTotals(rows: ManagerPaymentRow[], transferredCents: number) {
  const clients = new Set(rows.flatMap((row) => row.clientIds ?? [row.clientId]));
  const receivedCents = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const commissionCents = rows.reduce((sum, row) => sum + row.commissionCents, 0);
  return { receivedCents, commissionCents, transferredCents,
    pendingCents: commissionCents - transferredCents, clientCount: clients.size };
}

export type DelinquencyRow = {
  clientId: string; clientName: string; lawyerId: string; lawyerName: string;
  firstDueDate: string; installmentCount: number; balanceCents: number;
  potentialCents: number; latestContactAt: string | null;
};

export function managerDelinquency(data: ManagerWorkspace, today: string, filters?: {
  lawyerId?: string; month?: string; year?: string; client?: string;
}): DelinquencyRow[] {
  const terms = new Map(data.terms.map((term) => [term.contract_id, term]));
  const operational = buildOperationalRows(data.contracts, data.notes, today);
  const potential = new Map<string, number>();
  const commissionByPayment = new Map(data.commissions.map((commission) => [commission.payment_id, commission.commission_amount]));
  const rowsByContract = new Map<string, typeof operational>();
  for (const row of operational) {
    const group = rowsByContract.get(row.contractId) ?? [];
    group.push(row); rowsByContract.set(row.contractId, group);
  }
  for (const contract of data.contracts) {
    const term = terms.get(contract.id);
    const generatedCents = contract.installments.reduce((sum, item) => sum + item.payments.filter((payment) => !payment.voided_at)
      .reduce((subtotal, payment) => subtotal + numericToCents(commissionByPayment.get(payment.id) ?? 0), 0), 0);
    const order = new Map(contract.installments.map((item) => [item.id, item.installment_number]));
    const projection = projectContractCommissions((rowsByContract.get(contract.id) ?? []).map((row) => ({
      id: row.installmentId, dueDate: row.dueDate, order: order.get(row.installmentId) ?? 0,
      contractualCents: row.contractualCents, paidCents: row.paidCents,
    })), { ...term, commission_percentage: term?.commission_percentage ?? 0,
      total_contract_value: data.contractTotals.find((item) => item.id === contract.id)?.total_contract_value ?? null }, generatedCents);
    for (const [id, amounts] of projection) potential.set(id, amounts.remainingEstimatedCents);
  }
  const groups = new Map<string, DelinquencyRow>();
  for (const row of operational) {
    if (row.dueDate >= today || row.balanceCents <= 0) continue;
    if (filters?.lawyerId && row.lawyerId !== filters.lawyerId) continue;
    if (filters?.month && row.dueDate.slice(5, 7) !== filters.month) continue;
    if (filters?.year && row.dueDate.slice(0, 4) !== filters.year) continue;
    if (filters?.client && !row.clientName.toLocaleLowerCase("pt-BR")
      .includes(filters.client.toLocaleLowerCase("pt-BR"))) continue;
    const key = `${row.clientId}:${row.lawyerId}`;
    const current = groups.get(key) ?? {
      clientId: row.clientId, clientName: row.clientName, lawyerId: row.lawyerId,
      lawyerName: row.lawyerName, firstDueDate: row.dueDate, installmentCount: 0,
      balanceCents: 0, potentialCents: 0, latestContactAt: null,
    };
    current.firstDueDate = current.firstDueDate < row.dueDate ? current.firstDueDate : row.dueDate;
    current.installmentCount += 1;
    current.balanceCents += row.balanceCents;
    current.potentialCents += potential.get(row.installmentId) ?? 0;
    if (row.latestContactAt && (!current.latestContactAt || row.latestContactAt > current.latestContactAt)) {
      current.latestContactAt = row.latestContactAt;
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.firstDueDate.localeCompare(b.firstDueDate));
}

export function transferDeadline(closedAt: string | null, pendingCents: number, today: string) {
  if (!closedAt || pendingCents <= 0) return null;
  const closeDate = new Date(closedAt);
  const deadline = new Date(closeDate.getTime() + 30 * 86_400_000);
  const todayDate = new Date(`${today}T12:00:00-03:00`);
  const days = Math.ceil((deadline.getTime() - todayDate.getTime()) / 86_400_000);
  return { days, label: days < 0 ? "Prazo ultrapassado" : days <= 5 ? "Próximo do prazo" : "Dentro do prazo" };
}
