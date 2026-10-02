export function parseMoneyBR(input: string): number | null {
  const raw = input.trim().replace(/^R\$\s*/, "");
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.replaceAll(".", "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function numericToCents(value: number | string): number {
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || amount < 0) {
    throw new Error("Valor financeiro inválido.");
  }
  return cents;
}

export function participationCents(amountCents: number, percentage: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 ||
      !Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Cálculo de participação inválido.");
  }
  return Math.round(amountCents * percentage / 100);
}
