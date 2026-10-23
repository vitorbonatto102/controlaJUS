import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadContractParties } from "./parties-data";
import { loadContractServices } from "./service-data";
import type { ContractRecord, InstallmentRecord, PaymentRecord } from "./view";

const contractSelect = `
  id, client_id, origin, contract_date, updated_at, total_contract_value, payment_method, success_fee_percentage,
  contract_file_path, contract_file_name,
  payment_start_type, first_due_date, payment_start_condition, installment_count, installment_amount, last_installment_amount,
  has_additional_fee, additional_fee_percentage, additional_fee_basis, additional_fee_amount,
  clients (full_name, cpf),
  contract_financial_terms (commission_percentage),
  installments (
    id, installment_number, kind, regular_number, due_date, contractual_amount,
    payments (id, payment_date, amount_paid, voided_at, commissions (commission_amount))
  )
`;

type RawPayment = { id: string; payment_date: string; amount_paid: number; voided_at: string | null;
  commissions: { commission_amount: number } | { commission_amount: number }[] | null };
type RawInstallment = Omit<InstallmentRecord, "payments"> & { payments: RawPayment[] };
type RawContract = Omit<ContractRecord, "client_name" | "client_cpf" | "commission_percentage" | "installments"> & {
  clients: { full_name: string; cpf: string | null } | { full_name: string; cpf: string | null }[] | null;
  contract_financial_terms: { commission_percentage: number } | { commission_percentage: number }[] | null;
  installments: RawInstallment[];
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalize(raw: RawContract): ContractRecord {
  const client = one(raw.clients);
  const terms = one(raw.contract_financial_terms);
  if (!client || !terms) throw new Error("Contrato incompleto: cliente ou percentual ausente.");
  return {
    id: raw.id, client_id: raw.client_id, client_name: client.full_name,
    client_cpf: client.cpf, origin: raw.origin, contract_date: raw.contract_date,
    updated_at: raw.updated_at,
    total_contract_value: raw.total_contract_value, payment_method: raw.payment_method,
    success_fee_percentage: raw.success_fee_percentage == null ? null : Number(raw.success_fee_percentage),
    contract_file_path: raw.contract_file_path, contract_file_name: raw.contract_file_name,
    payment_start_type: raw.payment_start_type, first_due_date: raw.first_due_date,
    payment_start_condition: raw.payment_start_condition,
    installment_count: raw.installment_count == null ? null : Number(raw.installment_count),
    installment_amount: raw.installment_amount == null ? null : Number(raw.installment_amount),
    last_installment_amount: raw.last_installment_amount === null ? null : Number(raw.last_installment_amount),
    has_additional_fee: raw.has_additional_fee,
    additional_fee_percentage: raw.additional_fee_percentage === null ? null : Number(raw.additional_fee_percentage),
    additional_fee_basis: raw.additional_fee_basis,
    additional_fee_amount: raw.additional_fee_amount === null ? null : Number(raw.additional_fee_amount),
    commission_percentage: Number(terms.commission_percentage),
    installments: raw.installments.map((item) => ({
      id: item.id, installment_number: item.installment_number, kind: item.kind,
      regular_number: item.regular_number, due_date: item.due_date,
      contractual_amount: Number(item.contractual_amount),
      payments: item.payments.map((payment): PaymentRecord => ({
        id: payment.id, payment_date: payment.payment_date,
        amount_paid: Number(payment.amount_paid), voided_at: payment.voided_at,
        commissions: one(payment.commissions),
      })),
    })),
  };
}

export async function loadLawyerContracts(lawyerId: string): Promise<ContractRecord[]> {
  const supabase = await createClient();
  const pageSize = 100;
  const all: ContractRecord[] = [];
  let fields = contractSelect;
  for (let offset = 0; ; offset += pageSize) {
    const fetchPage = () => supabase.from("contracts")
      .select(fields)
      .eq("lawyer_id", lawyerId)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    let { data, error } = await fetchPage();
    // Mantém os contratos existentes acessíveis entre o deploy e a migration.
    if (error?.code === "42703" && error.message.includes("success_fee_percentage")) {
      fields = fields.replace(", success_fee_percentage", "");
      ({ data, error } = await fetchPage());
    }
    if (error) throw new Error("Não foi possível carregar os contratos.");
    const page = (data ?? []) as unknown as RawContract[];
    all.push(...page.map(normalize));
    if (page.length < pageSize) break;
  }
  const ids = all.map((contract) => contract.id);
  const [parties, services] = await Promise.all([loadContractParties(ids), loadContractServices(ids)]);
  return all.map((contract) => ({ ...contract, contractors: parties.get(contract.id), service_name: services.get(contract.id) ?? null }));
}

export async function loadLawyerContract(lawyerId: string, contractId: string): Promise<ContractRecord | null> {
  const supabase = await createClient();
  let fields = contractSelect;
  const fetchContract = () => supabase.from("contracts")
    .select(fields)
    .eq("id", contractId)
    .eq("lawyer_id", lawyerId)
    .maybeSingle();
  let { data, error } = await fetchContract();
  if (error?.code === "42703" && error.message.includes("success_fee_percentage")) {
    fields = fields.replace(", success_fee_percentage", "");
    ({ data, error } = await fetchContract());
  }
  if (error) throw new Error("Não foi possível carregar o contrato.");
  if (!data) return null;
  const contract = normalize(data as unknown as RawContract);
  const [parties, services] = await Promise.all([loadContractParties([contract.id]), loadContractServices([contract.id])]);
  return { ...contract, contractors: parties.get(contract.id), service_name: services.get(contract.id) ?? null };
}
