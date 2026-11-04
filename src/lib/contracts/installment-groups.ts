export type InstallmentGroup = { count: number; amount_cents: number };
export type InstallmentGroupInput = { count: string; amount: string };

/** Expande os grupos na ordem contratada; a última parcela pode ajustar centavos. */
export function installmentAmounts(count: number, firstAmount: number, groups: InstallmentGroup[] = [], lastAmount?: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 120 || !Number.isSafeInteger(firstAmount) || firstAmount <= 0 || firstAmount > 99999999999999)
    throw new Error("Informe quantidade e valor válidos para as parcelas (até 120 no total).");
  if (!Array.isArray(groups) || groups.length > 120) throw new Error("Confira os grupos de parcelas.");
  const amounts: number[] = [];
  for (const group of groups.length ? groups : [{count, amount_cents: firstAmount}]) {
    if (!group || !Number.isInteger(group.count) || group.count < 1 || group.count > 120 ||
      !Number.isSafeInteger(group.amount_cents) || group.amount_cents <= 0 || group.amount_cents > 99999999999999 || amounts.length + group.count > 120)
      throw new Error("Informe a quantidade e o valor de cada grupo (até 120 parcelas no total).");
    amounts.push(...Array<number>(group.count).fill(group.amount_cents));
  }
  if (amounts.length !== count || amounts[0] !== firstAmount) throw new Error("Os grupos não correspondem à quantidade e ao valor inicial das parcelas.");
  if (lastAmount !== undefined) {
    if (count < 2 || !Number.isSafeInteger(lastAmount) || lastAmount <= 0 || lastAmount > 99999999999999)
      throw new Error("Informe um valor válido para a última parcela.");
    amounts[count - 1] = lastAmount;
  }
  if (amounts.reduce((sum, amount) => sum + amount, 0) > 99999999999999) throw new Error("Valor do cronograma excede o limite.");
  return amounts;
}
