import { parseMoneyBR } from "./finance";
import { isValidCpf, MAX_PDF_BYTES } from "./validation";

export type ExtractedContractData = {
  contractorName: string | null;
  cpf: string | null;
  contractDate: string | null;
  totalValue: string | null;
  paymentType: "cash" | "installments" | null;
  installmentCount: number | null;
  installmentValue: string | null;
  firstDueDate: string | null;
  paymentStartType: "fixed_date" | "condition" | null;
  paymentStartCondition: string | null;
  hasAdditionalFee: boolean;
  additionalFeePercentage: number | null;
  additionalFeeBasis: string | null;
};

export class ContractExtractionError extends Error {}

const monthNames: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const monthWord = "janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const dateSource = `(?:\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|\\d{1,2}\\s+de\\s+(?:${monthWord})\\s+de\\s+\\d{4})`;

function brazilianDate(value: string): string | null {
  const numeric = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value.trim());
  const written = new RegExp(`^(\\d{1,2})\\s+de\\s+(${monthWord})\\s+de\\s+(\\d{4})$`, "i").exec(value.trim());
  if (!numeric && !written) return null;
  const day = Number((numeric ?? written)![1]);
  const month = numeric ? Number(numeric[2]) : monthNames[written![2].toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
  const year = Number((numeric ?? written)![3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function moneyAfter(text: string, expression: RegExp): string | null {
  const match = expression.exec(text);
  const value = match?.[1].replace(/[^\d.,]/g, "") ?? null;
  return value && parseMoneyBR(value) !== null ? value : null;
}

export function parseContractText(rawText: string): ExtractedContractData {
  const text = rawText.normalize("NFC").replace(/\s+/g, " ").trim();
  const contractorName = /\bCONTRATANTE\s*:\s*([^,]{2,160}?)\s*,/i.exec(text)?.[1].trim() ?? null;
  const cpfMatch = /inscrit[oa]\s+no\s+CPF\s+sob\s+o\s*(?:n\s*[º°o.]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i
    .exec(text)?.[1] ?? null;
  const cpf = cpfMatch && isValidCpf(cpfMatch) ? cpfMatch : null;

  const clauseStart = /\b2\.1\.\s*O\s+valor\s+total\s+dos\s+honor[aá]rios\s+advocat[ií]cios\b/i.exec(text);
  const rest = clauseStart ? text.slice(clauseStart.index) : "";
  const clauseEnd = /\b2\.1\.1\b|\b2\.2\./.exec(rest);
  const clause = rest.slice(0, clauseEnd?.index ?? 1800);
  const totalValue = moneyAfter(clause, /[ée]\s+de\s*R\$\s*([\d.,]*\d)/i);
  const countMatch = /a\s+serem\s+pagos\s+em\s+(\d{1,3})(?:\s*\([^)]*\))?\s+parcelas\b/i.exec(clause);
  const installmentCount = countMatch ? Number(countMatch[1]) : null;
  const regularValue = moneyAfter(clause,
    /parcelas\s+mensais\s+e\s+sucessivas\s+de\s*R\$\s*([\d.,]*\d)/i);
  const cash = /(?:pagamento|pagos?|quitad[oa]s?)\s+(?:ser[aá]\s+)?(?:feito\s+)?[àa]\s+vista\b/i.test(clause);
  const paymentType = installmentCount !== null ? "installments" : cash ? "cash" : null;
  const installmentValue = regularValue ?? (cash ? totalValue : null);

  const dueAnchor = new RegExp(
    `(?:primeiro\\s+vencimento|vencimento\\s+da\\s+primeira\\s+parcela|primeira\\s+parcela\\s+vencer[aá]\\s+em|in[ií]cio\\s+dos\\s+pagamentos\\s+em|com\\s+vencimento\\s+em)\\s*[:–-]?\\s*(?:ser[aá]\\s+)?(?:em\\s+|no\\s+dia\\s+)?(${dateSource})`, "i");
  const firstDueDate = brazilianDate(dueAnchor.exec(clause)?.[1] ?? "");
  const conditionMatch = /in[ií]cio\s+dos\s+pagamentos\s+(?:(?:ocorrer[aá]|se\s+dar[aá])\s+)?(?:somente\s+)?ap[oó]s\s+([^.;]{5,500}(?:\/(?:ou|e)\s*[^.;]{1,100})?)/i.exec(clause);
  const paymentStartCondition = !firstDueDate && conditionMatch ?
    `Após ${conditionMatch[1].trim().replace(/[,.\s]+$/, "")}` : null;

  const additionalClause = /al[eé]m\s+do\s+valor\s+acima\s+descrito[^.]{0,400}|\d{1,3}\s*%\s+sobre\s+o\s+proveito\s+econ[oô]mico/i.exec(text)?.[0] ?? "";
  const hasAdditionalFee = /(?:al[eé]m\s+do\s+valor\s+acima\s+descrito|\d{1,3}\s*%\s+sobre\s+o\s+proveito\s+econ[oô]mico)/i
    .test(additionalClause);
  const additionalMatch = /\b(\d{1,3})\s*%\s+sobre\s+o\s+(proveito\s+econ[oô]mico)\b/i.exec(additionalClause);
  const additionalFeePercentage = hasAdditionalFee && additionalMatch ? Number(additionalMatch[1]) : null;
  const additionalFeeBasis = hasAdditionalFee && additionalMatch ? additionalMatch[2].replace(/\s+/g, " ").toLowerCase() : null;

  const footer = new RegExp(`\\b[\\p{L}][\\p{L}\\s]{1,80}\\s*[-–/]\\s*[A-Z]{2}\\s*,\\s*(${dateSource})`, "giu");
  const footerDates = [...text.matchAll(footer)];
  const contractDate = brazilianDate(footerDates.at(-1)?.[1] ?? "");

  return {
    contractorName, cpf, contractDate, totalValue, paymentType, installmentCount,
    installmentValue, firstDueDate,
    paymentStartType: firstDueDate ? "fixed_date" : paymentStartCondition ? "condition" : null,
    paymentStartCondition, hasAdditionalFee, additionalFeePercentage, additionalFeeBasis,
  };
}

export async function extractContractData(bytes: Uint8Array): Promise<ExtractedContractData> {
  if (bytes.length < 5 || bytes.length > MAX_PDF_BYTES ||
      ![37, 80, 68, 70, 45].every((byte, index) => bytes[index] === byte)) {
    throw new ContractExtractionError("Envie um PDF válido de até 10 MB.");
  }
  try {
    // O worker é carregado explicitamente para ser incluído no bundle da Vercel.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: bytes, useSystemFonts: true });
    try {
      const pdf = await task.promise;
      const pages: string[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
        page.cleanup();
      }
      const text = pages.join(" ").trim();
      if (!text) throw new ContractExtractionError("Este PDF não contém texto extraível. Cadastre manualmente.");
      return parseContractText(text);
    } finally {
      await task.destroy();
    }
  } catch (error) {
    if (error instanceof ContractExtractionError) throw error;
    throw new ContractExtractionError("Não foi possível ler este PDF. Confira o arquivo ou cadastre manualmente.");
  }
}
