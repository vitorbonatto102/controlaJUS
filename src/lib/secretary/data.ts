import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LawyerOption, OperationalContract, OperationalInstallment, OperationalNote, OperationalPayment } from "./view";

type RawContract = {
  id: string; client_id: string; lawyer_id: string; origin: string; contract_date: string;
  clients: { full_name: string; cpf: string | null } | { full_name: string; cpf: string | null }[] | null;
};
type RawInstallment = Omit<OperationalInstallment, "payments">;
type RawNote = Omit<OperationalNote, "author_name">;
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

async function allPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const result: T[] = [];
  const size = 200;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await fetchPage(offset, offset + size - 1);
    if (error) throw new Error("Não foi possível carregar os dados operacionais.");
    result.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return result;
}

export async function loadSecretaryWorkspace(): Promise<{
  contracts: OperationalContract[]; notes: OperationalNote[]; lawyers: LawyerOption[];
  users: { id: string; full_name: string }[];
}> {
  const supabase = await createClient();
  // DTO operacional: nunca consulta contract_financial_terms, commissions ou closings.
  const [rawContracts, rawInstallments, rawPayments, rawNotes, profiles] = await Promise.all([
    allPages<RawContract>((from, to) => supabase.from("contracts").select(`
      id, client_id, lawyer_id, origin, contract_date, clients (full_name, cpf)
    `).order("id").range(from, to) as unknown as Promise<{ data: RawContract[] | null; error: { message: string } | null }>),
    allPages<RawInstallment>((from, to) => supabase.from("installments")
      .select("id, contract_id, installment_number, kind, regular_number, due_date, contractual_amount")
      .order("id").range(from, to) as unknown as Promise<{
        data: RawInstallment[] | null; error: { message: string } | null;
      }>),
    allPages<OperationalPayment>((from, to) => supabase.from("payments")
      .select("id, installment_id, payment_date, amount_paid, recorded_by, created_at, observation, voided_at, void_reason, replaces_payment_id")
      .order("id").range(from, to) as unknown as Promise<{
        data: OperationalPayment[] | null; error: { message: string } | null;
      }>),
    allPages<RawNote>((from, to) => supabase.from("collection_notes")
      .select("id, client_id, contract_id, installment_id, author_id, note_type, content, created_at")
      .order("created_at", { ascending: false }).order("id").range(from, to) as unknown as Promise<{
        data: RawNote[] | null; error: { message: string } | null;
      }>),
    allPages<{ id: string; full_name: string; role: string; active: boolean }>((from, to) =>
      supabase.from("profiles").select("id, full_name, role, active").order("id")
        .range(from, to) as unknown as Promise<{
          data: { id: string; full_name: string; role: string; active: boolean }[] | null;
          error: { message: string } | null;
        }>),
  ]);
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const paymentsByInstallment = new Map<string, OperationalPayment[]>();
  for (const payment of rawPayments) {
    const existing = paymentsByInstallment.get(payment.installment_id) ?? [];
    existing.push({ ...payment, amount_paid: Number(payment.amount_paid) });
    paymentsByInstallment.set(payment.installment_id, existing);
  }
  const installmentsByContract = new Map<string, OperationalInstallment[]>();
  for (const installment of rawInstallments) {
    const existing = installmentsByContract.get(installment.contract_id) ?? [];
    existing.push({ ...installment, contractual_amount: Number(installment.contractual_amount),
      payments: paymentsByInstallment.get(installment.id) ?? [] });
    installmentsByContract.set(installment.contract_id, existing);
  }
  return {
    users: profiles.map(({ id, full_name }) => ({ id, full_name })),
    lawyers: profiles.filter((profile) => profile.role === "lawyer" && profile.active)
      .map(({ id, full_name }) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
    contracts: rawContracts.map((contract) => {
      const client = one(contract.clients);
      if (!client) throw new Error("Contrato sem cliente associado.");
      return {
        id: contract.id, client_id: contract.client_id, lawyer_id: contract.lawyer_id,
        lawyer_name: names.get(contract.lawyer_id) ?? "Advogada inativa",
        client_name: client.full_name, client_cpf: client.cpf, origin: contract.origin,
        contract_date: contract.contract_date,
        installments: (installmentsByContract.get(contract.id) ?? [])
          .sort((a, b) => a.installment_number - b.installment_number),
      };
    }),
    notes: rawNotes.map((note) => ({ ...note, author_name: names.get(note.author_id) ?? "Usuário inativo" })),
  };
}
