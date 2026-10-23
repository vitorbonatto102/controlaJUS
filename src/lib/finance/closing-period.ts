export function closingAvailability(year: number, month: number, today: string) {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Período de fechamento inválido.");
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { lastDay, canConfirm: today >= lastDay };
}
