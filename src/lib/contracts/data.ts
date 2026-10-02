import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContractRecord, InstallmentRecord, PaymentRecord } from "./view";

const contractSelect = `
  id, client_id, origin, contract_date, total_contract_value, payment_method,
  contract_file_path, contract_file_name,
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
    total_contract_value: raw.total_contract_value, payment_method: raw.payment_method,
    contract_file_path: raw.contract_file_path, contract_file_name: raw.contract_file_name,
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
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("contracts")
      .select(contractSelect)
      .eq("lawyer_id", lawyerId)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("Não foi possível carregar os contratos.");
    const page = (data ?? []) as unknown as RawContract[];
    all.push(...page.map(normalize));
    if (page.length < pageSize) break;
  }
  return all;
}

export async function loadLawyerContract(lawyerId: string, contractId: string): Promise<ContractRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contracts")
    .select(contractSelect)
    .eq("id", contractId)
    .eq("lawyer_id", lawyerId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar o contrato.");
  return data ? normalize(data as unknown as RawContract) : null;
}
