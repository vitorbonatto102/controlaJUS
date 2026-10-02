import { parseMoneyBR } from "./finance";
import { buildSchedule, parseIsoDate, type ScheduleRow } from "./schedule";
import { isValidCpf, ORIGINS, PERCENTAGES } from "./validation";

export type ContractFormValues = {
  clientName: string;
  cpf: string;
  contractDate: string;
  total: string;
  method: "" | "cash" | "installments";
  count: string;
  installmentValue: string;
  lastInstallmentValue: string;
  paymentStartType: "" | "fixed_date" | "condition";
  firstDue: string;
  paymentStartCondition: string;
  hasEntry: boolean;
  entryValue: string;
  entryDue: string;
  hasAdditionalFee: boolean;
  additionalFeePercentage: string;
  additionalFeeBasis: string;
  additionalFeeAmount: string;
  origin: string;
  percentage: string;
};

export type ContractPreview = {
  rows: ScheduleRow[];
  totalCents: number;
  installmentCents: number;
  lastInstallmentCents: number | null;
  installmentCount: number;
  sumCents: number;
  differenceCents: number;
  additionalFeeAmountCents: number | null;
  percentage: number;
  contractDate: string;
  firstDueDate: string | null;
};

export const blankContractForm: ContractFormValues = {
  clientName: "", cpf: "", contractDate: "", total: "", method: "", count: "",
  installmentValue: "", lastInstallmentValue: "", paymentStartType: "", firstDue: "", paymentStartCondition: "",
  hasEntry: false, entryValue: "", entryDue: "", hasAdditionalFee: false,
  additionalFeePercentage: "", additionalFeeBasis: "", additionalFeeAmount: "",
  origin: "", percentage: "",
};

export function brazilianToIso(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error("Informe a data em DD/MM/AAAA.");
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  parseIsoDate(iso);
  return iso;
}

export function prepareContract(values: ContractFormValues): ContractPreview {
  if (values.clientName.trim().length < 2 || values.clientName.trim().length > 160) {
    throw new Error("Informe o nome completo do contratante.");
  }
  if (!isValidCpf(values.cpf)) throw new Error("Informe um CPF válido.");
  const contractDate = brazilianToIso(values.contractDate);
  if (!ORIGINS.some((origin) => origin === values.origin)) throw new Error("Selecione a origem da contratação.");
  const percentage = Number(values.percentage);
  if (!PERCENTAGES.some((item) => item === percentage)) throw new Error("Selecione um percentual permitido.");
  const totalCents = parseMoneyBR(values.total);
  if (totalCents === null || totalCents <= 0) throw new Error("Informe o valor total contratado.");
  if (values.method !== "cash" && values.method !== "installments") {
    throw new Error("Selecione a forma de pagamento.");
  }
  const installmentCount = values.method === "cash" ? 1 : Number(values.count);
  const installmentCents = parseMoneyBR(values.installmentValue);
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120 ||
      installmentCents === null || installmentCents <= 0) {
    throw new Error("Informe a quantidade e o valor das parcelas.");
  }
  const lastInstallmentCents = values.method === "installments" && values.lastInstallmentValue.trim() ?
    parseMoneyBR(values.lastInstallmentValue) : null;
  if (values.lastInstallmentValue.trim() &&
      (values.method !== "installments" || installmentCount < 2 ||
       lastInstallmentCents === null || lastInstallmentCents <= 0)) {
    throw new Error("Informe um valor válido para a última parcela.");
  }
  if (values.paymentStartType !== "fixed_date" && values.paymentStartType !== "condition") {
    throw new Error("Defina o início dos pagamentos.");
  }
  const firstDueDate = values.paymentStartType === "fixed_date" ? brazilianToIso(values.firstDue) : null;
  if (values.paymentStartType === "condition" &&
      (values.paymentStartCondition.trim().length < 5 || values.paymentStartCondition.trim().length > 500)) {
    throw new Error("Descreva a condição para início dos pagamentos.");
  }
  if (values.paymentStartType === "condition" && values.hasEntry) {
    throw new Error("Defina uma data fixa antes de incluir uma entrada no cronograma.");
  }
  if (values.hasAdditionalFee && values.additionalFeePercentage.trim()) {
    const fee = Number(values.additionalFeePercentage);
    if (!Number.isFinite(fee) || fee <= 0 || fee > 100 || Math.round(fee * 100) !== fee * 100) {
      throw new Error("Informe um percentual válido para os honorários adicionais.");
    }
  }
  if (values.hasAdditionalFee && values.additionalFeeBasis.trim() &&
      (values.additionalFeeBasis.trim().length < 2 || values.additionalFeeBasis.trim().length > 200)) {
    throw new Error("Confira a base dos honorários adicionais.");
  }
  const additionalFeeAmountCents = values.hasAdditionalFee && values.additionalFeeAmount.trim() ?
    parseMoneyBR(values.additionalFeeAmount) : null;
  if (values.hasAdditionalFee && values.additionalFeeAmount.trim() && additionalFeeAmountCents === null) {
    throw new Error("Informe um valor eventual válido.");
  }

  let rows: ScheduleRow[] = [];
  let sumCents = (installmentCount - 1) * installmentCents +
    (lastInstallmentCents ?? installmentCents);
  if (firstDueDate) {
    const schedule = values.method === "cash" ? buildSchedule({
      method: "cash", totalCents, cashCents: installmentCents, cashDueDate: firstDueDate,
    }) : buildSchedule({
      method: "installments", totalCents, count: installmentCount,
      installmentCents, firstDueDate,
      ...(lastInstallmentCents !== null ? { lastInstallmentCents } : {}),
      ...(values.hasEntry ? { entryCents: parseMoneyBR(values.entryValue) ?? 0,
        entryDueDate: brazilianToIso(values.entryDue) } : {}),
    });
    rows = schedule.rows;
    sumCents = schedule.sumCents;
  }
  return { rows, totalCents, installmentCents, lastInstallmentCents, installmentCount, sumCents,
    differenceCents: totalCents - sumCents, additionalFeeAmountCents,
    percentage, contractDate, firstDueDate };
}
