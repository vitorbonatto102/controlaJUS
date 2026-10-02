import { numericToCents } from "@/lib/contracts/finance";

export type OperationalPayment = {
  id: string; installment_id: string; payment_date: string; amount_paid: number;
  recorded_by: string; created_at: string; observation: string | null;
  voided_at: string | null; void_reason: string | null; replaces_payment_id: string | null;
};
export type OperationalInstallment = {
  id: string; contract_id: string; installment_number: number;
  kind: "down_payment" | "regular"; regular_number: number | null;
  due_date: string; contractual_amount: number; payments: OperationalPayment[];
};
export type OperationalContract = {
  id: string; client_id: string; lawyer_id: string; lawyer_name: string;
  client_name: string; client_cpf: string | null; origin: string;
  contract_date: string; installments: OperationalInstallment[];
};
export type OperationalNote = {
  id: string; client_id: string; contract_id: string | null; installment_id: string | null;
  author_id: string; author_name: string; note_type: string; content: string; created_at: string;
};
export type LawyerOption = { id: string; full_name: string };
export type OperationalStatus = "upcoming" | "today" | "overdue" | "partial" | "paid";
export const operationalStatusLabels: Record<OperationalStatus, string> = {
  upcoming: "A vencer", today: "Vence hoje", overdue: "Vencida",
  partial: "Parcialmente paga", paid: "Paga",
};
export const noteTypeLabels: Record<string, string> = {
  collection: "Cobrança", client_reply: "Retorno do cliente",
  renegotiation: "Renegociação", general: "Informação geral",
};
export type OperationalRow = {
  contractId: string; clientId: string; clientName: string; lawyerId: string; lawyerName: string;
  installmentId: string; installmentLabel: string; dueDate: string; origin: string;
  contractualCents: number; paidCents: number; balanceCents: number;
  latestPaymentDate: string | null; latestContactAt: string | null; status: OperationalStatus;
};
export type OperationalFilters = {
  lawyerId: string; clientId: string; month: string; year: string;
  status: string; dueDate: string; origin: string;
};

export function operationalStatus(contractualCents: number, paidCents: number,
  dueDate: string, today: string): OperationalStatus {
  if (paidCents >= contractualCents) return "paid";
  if (paidCents > 0) return "partial";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "upcoming";
}

export function buildOperationalRows(contracts: OperationalContract[], notes: OperationalNote[],
  today: string): OperationalRow[] {
  return contracts.flatMap((contract) => {
    const regularCount = contract.installments.filter((item) => item.kind === "regular").length;
    return contract.installments.map((item) => {
      const active = item.payments.filter((payment) => !payment.voided_at);
      const contractualCents = numericToCents(item.contractual_amount);
      const paidCents = active.reduce((sum, payment) => sum + numericToCents(payment.amount_paid), 0);
      const contacts = notes.filter((note) => note.client_id === contract.client_id &&
        (note.installment_id === item.id || (note.installment_id === null &&
          (note.contract_id === null || note.contract_id === contract.id))));
      return {
        contractId: contract.id, clientId: contract.client_id, clientName: contract.client_name,
        lawyerId: contract.lawyer_id, lawyerName: contract.lawyer_name, installmentId: item.id,
        installmentLabel: item.kind === "down_payment" ? "Entrada" :
          `${item.regular_number ?? item.installment_number}/${regularCount}`,
        dueDate: item.due_date, origin: contract.origin, contractualCents, paidCents,
        balanceCents: Math.max(0, contractualCents - paidCents),
        latestPaymentDate: active.reduce<string | null>((latest, payment) =>
          !latest || payment.payment_date > latest ? payment.payment_date : latest, null),
        latestContactAt: contacts.reduce<string | null>((latest, note) =>
          !latest || note.created_at > latest ? note.created_at : latest, null),
        status: operationalStatus(contractualCents, paidCents, item.due_date, today),
      };
    });
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

export function filterOperationalRows(rows: OperationalRow[], filters: OperationalFilters,
  today: string): OperationalRow[] {
  return rows.filter((row) =>
    (!filters.lawyerId || row.lawyerId === filters.lawyerId) &&
    (!filters.clientId || row.clientId === filters.clientId) &&
    (!filters.month || row.dueDate.slice(5, 7) === filters.month) &&
    (!filters.year || row.dueDate.slice(0, 4) === filters.year) &&
    (!filters.dueDate || row.dueDate === filters.dueDate) &&
    (!filters.origin || row.origin === filters.origin) &&
    (!filters.status || (filters.status === "delinquent" ?
      row.dueDate < today && row.balanceCents > 0 : row.status === filters.status)));
}

export function summarizeOperations(rows: OperationalRow[], contracts: OperationalContract[], today: string) {
  const month = today.slice(0, 7);
  const activePayments = contracts.flatMap((contract) => contract.installments.flatMap((item) =>
    item.payments.filter((payment) => !payment.voided_at && payment.payment_date.startsWith(month))));
  return {
    dueToday: rows.filter((row) => row.dueDate === today && row.balanceCents > 0).length,
    upcomingThisMonth: rows.filter((row) => row.dueDate > today && row.dueDate.startsWith(month) && row.balanceCents > 0).length,
    overdue: rows.filter((row) => row.dueDate < today && row.balanceCents > 0).length,
    paymentsThisMonth: activePayments.length,
    receivedCentsThisMonth: activePayments.reduce((sum, item) => sum + numericToCents(item.amount_paid), 0),
  };
}
