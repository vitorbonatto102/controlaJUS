const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Valor monetário inválido.");
  return currencyFormatter.format(value);
}

export function formatDateBR(value: string | Date): string {
  // Datas de coluna DATE chegam como YYYY-MM-DD: formatar sem fuso horário.
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("Data inválida; esperado AAAA-MM-DD.");
    const [, year, month, day] = match;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() !== Number(year) ||
        parsed.getUTCMonth() + 1 !== Number(month) ||
        parsed.getUTCDate() !== Number(day)) {
      throw new Error("Data inválida.");
    }
    return `${day}/${month}/${year}`;
  }
  if (Number.isNaN(value.getTime())) throw new Error("Data inválida.");
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(value);
}
