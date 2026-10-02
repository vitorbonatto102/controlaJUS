export type ScheduleRow = {
  installment_number: number;
  kind: "down_payment" | "regular";
  regular_number: number | null;
  due_date: string;
  amount_cents: number;
};

export type PaymentPlan =
  | { method: "cash"; totalCents: number; cashCents: number; cashDueDate: string }
  | { method: "installments"; totalCents: number; count: number; installmentCents: number;
      firstDueDate: string; entryCents?: number; entryDueDate?: string };

export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Informe uma data válida.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day) throw new Error("Informe uma data válida.");
  return { year, month, day };
}

export function addMonthsClamped(isoDate: string, offset: number): string {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("Mês inválido.");
  const { year, month, day } = parseIsoDate(isoDate);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const due = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)));
  return due.toISOString().slice(0, 10);
}

export function buildSchedule(plan: PaymentPlan): { rows: ScheduleRow[]; sumCents: number; differenceCents: number } {
  if (!Number.isSafeInteger(plan.totalCents) || plan.totalCents <= 0) {
    throw new Error("Informe o valor total do contrato.");
  }
  let rows: ScheduleRow[];
  if (plan.method === "cash") {
    if (!Number.isSafeInteger(plan.cashCents) || plan.cashCents <= 0) {
      throw new Error("Informe o valor à vista.");
    }
    parseIsoDate(plan.cashDueDate);
    rows = [{ installment_number: 1, kind: "regular", regular_number: 1,
      due_date: plan.cashDueDate, amount_cents: plan.cashCents }];
  } else {
    if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > 120 ||
        !Number.isSafeInteger(plan.installmentCents) || plan.installmentCents <= 0) {
      throw new Error("Informe quantidade e valor válidos para as parcelas.");
    }
    parseIsoDate(plan.firstDueDate);
    rows = [];
    if (plan.entryCents !== undefined) {
      if (!Number.isSafeInteger(plan.entryCents) || plan.entryCents <= 0 || !plan.entryDueDate) {
        throw new Error("Informe o valor e o vencimento da entrada.");
      }
      parseIsoDate(plan.entryDueDate);
      if (plan.entryDueDate > plan.firstDueDate) {
        throw new Error("A entrada deve vencer até a primeira parcela.");
      }
      rows.push({ installment_number: 1, kind: "down_payment", regular_number: null,
        due_date: plan.entryDueDate, amount_cents: plan.entryCents });
    }
    for (let number = 1; number <= plan.count; number++) {
      rows.push({ installment_number: rows.length + 1, kind: "regular", regular_number: number,
        due_date: addMonthsClamped(plan.firstDueDate, number - 1), amount_cents: plan.installmentCents });
    }
  }
  const sumCents = rows.reduce((sum, row) => sum + row.amount_cents, 0);
  if (!Number.isSafeInteger(sumCents)) throw new Error("Valor do cronograma excede o limite.");
  return { rows, sumCents, differenceCents: plan.totalCents - sumCents };
}
