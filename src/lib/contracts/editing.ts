import { blankContractForm, brazilianToIso, prepareContract, type ContractFormValues } from "./registration";
import type { ContractRecord } from "./view";
import { ORIGINS } from "./validation";
import { formatBRL, formatDateBR } from "../formatters";
import { getContractParties, MAX_CONTRACTORS } from "./parties";
import { validateServiceName } from "./service";

const amount = (value: number | null | undefined) => value == null ? "" : formatBRL(value);

export function contractHasPayments(contract: ContractRecord) {
  // Voided payments also belong to the permanent financial history.
  return contract.installments.some((installment) => installment.payments.length > 0);
}

export function contractToForm(contract: ContractRecord): ContractFormValues {
  const regular = contract.installments.filter((item) => item.kind === "regular")
    .sort((a, b) => a.installment_number - b.installment_number);
  const entry = contract.installments.find((item) => item.kind === "down_payment");
  return { ...blankContractForm, clientName: contract.client_name, cpf: contract.client_cpf ?? "",
    additionalContractors: getContractParties(contract).filter((party) => party.clientId !== contract.client_id)
      .map((party) => ({ fullName: party.fullName, cpf: party.cpf ?? "" })),
    serviceName: contract.service_name ?? "",
    contractDate: formatDateBR(contract.contract_date), total: amount(contract.total_contract_value),
    method: contract.payment_method ?? "", successFeePercentage: contract.success_fee_percentage?.toString() ?? "",
    count: (contract.installment_count ?? (regular.length || (contract.payment_method === "cash" ? 1 : ""))).toString(),
    installmentValue: amount(contract.installment_amount ?? regular[0]?.contractual_amount),
    lastInstallmentValue: amount(contract.last_installment_amount),
    paymentStartType: contract.payment_start_type ?? (regular.length ? "fixed_date" : ""),
    firstDue: contract.first_due_date || regular[0]?.due_date ? formatDateBR(contract.first_due_date ?? regular[0].due_date) : "",
    paymentStartCondition: contract.payment_start_condition ?? "",
    hasEntry: !!entry, entryValue: amount(entry?.contractual_amount), entryDue: entry ? formatDateBR(entry.due_date) : "",
    hasAdditionalFee: contract.has_additional_fee ?? false,
    additionalFeePercentage: contract.additional_fee_percentage?.toString() ?? "",
    additionalFeeBasis: contract.additional_fee_basis ?? "", additionalFeeAmount: amount(contract.additional_fee_amount),
    origin: contract.origin, percentage: String(contract.commission_percentage),
    commissionMode: contract.commission_mode ?? "proportional",
    commissionLimit: amount(contract.commission_upfront_limit),
  };
}

export function parseEditValues(raw: unknown): ContractFormValues {
  if (!raw || typeof raw !== "object") throw new Error("Confira os dados do contrato.");
  const record = raw as Record<string, unknown>;
  const values = { ...blankContractForm };
  for (const key of Object.keys(blankContractForm) as (keyof ContractFormValues)[]) {
    if (key === "additionalContractors") {
      const parties = record[key];
      if (!Array.isArray(parties) || parties.length >= MAX_CONTRACTORS || parties.some((party) =>
        !party || typeof party.fullName !== "string" || typeof party.cpf !== "string" || party.fullName.length > 160 || party.cpf.length > 14))
        throw new Error("Confira os contratantes do contrato.");
      values.additionalContractors = parties.map((party) => ({ fullName: party.fullName, cpf: party.cpf }));
      continue;
    }
    if (typeof record[key] !== typeof blankContractForm[key]) throw new Error("Confira os dados do contrato.");
    if (typeof record[key] === "string" && record[key].length > 1000) throw new Error("Campo muito longo.");
    Object.assign(values, { [key]: record[key] });
  }
  return values;
}

export function prepareContractEdit(values: ContractFormValues, metadataOnly: boolean) {
  if (!ORIGINS.some((origin) => origin === values.origin)) throw new Error("Selecione a origem da contratação.");
  const base = { origin: values.origin, contract_date: brazilianToIso(values.contractDate),
    service_name: validateServiceName(values.serviceName) };
  if (metadataOnly) return { changes: base, schedule: null };
  // The client relationship is immutable here; identity is not being created or edited.
  const preview = prepareContract(values, { validateClient: false });
  if (preview.differenceCents !== 0) throw new Error("O total do cronograma deve ser igual ao valor do contrato.");
  const success = preview.method === "success_only";
  return { changes: { ...base, commission_percentage: preview.percentage,
    commission_mode: preview.commissionMode,
    commission_upfront_limit: success && preview.commissionLimitCents !== null ? preview.commissionLimitCents / 100 : null,
    total_contract_value: preview.totalCents === null ? null : preview.totalCents / 100,
    payment_method: preview.method, success_fee_percentage: preview.successFeePercentage,
    payment_start_type: success ? null : values.paymentStartType,
    first_due_date: preview.firstDueDate,
    payment_start_condition: !success && values.paymentStartType === "condition" ? values.paymentStartCondition.trim() : null,
    installment_count: success ? null : preview.installmentCount,
    installment_amount: preview.installmentCents === null ? null : preview.installmentCents / 100,
    last_installment_amount: preview.lastInstallmentCents === null ? null : preview.lastInstallmentCents / 100,
    has_additional_fee: !success && values.hasAdditionalFee,
    additional_fee_percentage: !success && values.hasAdditionalFee && values.additionalFeePercentage ? Number(values.additionalFeePercentage) : null,
    additional_fee_basis: !success && values.hasAdditionalFee ? values.additionalFeeBasis.trim() || null : null,
    additional_fee_amount: preview.additionalFeeAmountCents === null ? null : preview.additionalFeeAmountCents / 100,
  }, schedule: preview.rows };
}
