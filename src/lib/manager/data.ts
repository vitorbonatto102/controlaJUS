import "server-only";
import { loadSecretaryWorkspace } from "@/lib/secretary/data";
import { createClient } from "@/lib/supabase/server";
import { loadAuditEntries, loadClosingDetails, loadClosings } from "@/lib/finance/data";
import type { OperationalContract, OperationalNote } from "@/lib/secretary/view";
import type { Closing, ClosingAdjustment, ClosingItem, Transfer, AuditEntry } from "@/lib/finance/data";

export type ManagerWorkspace = {
  contracts: OperationalContract[];
  notes: OperationalNote[];
  lawyers: { id: string; full_name: string; active: boolean }[];
  terms: { contract_id: string; commission_percentage: number }[];
  contractTotals: { id: string; total_contract_value: number }[];
  commissions: { id: string; payment_id: string; lawyer_id: string;
    commission_percentage: number; commission_amount: number }[];
  closings: Closing[];
  items: ClosingItem[];
  transfers: Transfer[];
  adjustments: ClosingAdjustment[];
  audit: AuditEntry[];
  users: { id: string; full_name: string }[];
};

async function allPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await fetchPage(offset, offset + 199);
    if (error) throw new Error("Não foi possível carregar o painel do gestor.");
    result.push(...(data ?? []));
    if (!data || data.length < 200) break;
  }
  return result;
}

export async function loadManagerWorkspace(): Promise<ManagerWorkspace> {
  const supabase = await createClient();
  const [operational, terms, commissions, lawyers, closings, details, audit, contractTotals] = await Promise.all([
    loadSecretaryWorkspace(),
    allPages<{ contract_id: string; commission_percentage: number }>((from, to) =>
      supabase.from("contract_financial_terms").select("contract_id,commission_percentage")
        .order("contract_id").range(from, to) as unknown as Promise<{
          data: { contract_id: string; commission_percentage: number }[] | null;
          error: { message: string } | null;
        }>),
    allPages<ManagerWorkspace["commissions"][number]>((from, to) =>
      supabase.from("commissions").select("id,payment_id,lawyer_id,commission_percentage,commission_amount")
        .order("id").range(from, to) as unknown as Promise<{
          data: ManagerWorkspace["commissions"] | null; error: { message: string } | null;
        }>),
    allPages<{ id: string; full_name: string; active: boolean }>((from, to) =>
      supabase.from("profiles").select("id,full_name,active").eq("role", "lawyer")
        .order("full_name").range(from, to) as unknown as Promise<{
          data: { id: string; full_name: string; active: boolean }[] | null;
          error: { message: string } | null;
        }>),
    loadClosings(), loadClosingDetails(), loadAuditEntries(),
    allPages<{ id: string; total_contract_value: number }>((from, to) =>
      supabase.from("contracts").select("id,total_contract_value").order("id")
        .range(from, to) as unknown as Promise<{
          data: { id: string; total_contract_value: number }[] | null;
          error: { message: string } | null;
        }>),
  ]);
  return {
    ...operational, lawyers,
    terms: terms.map((item) => ({ ...item, commission_percentage: Number(item.commission_percentage) })),
    contractTotals: contractTotals.map((item) => ({ ...item,
      total_contract_value: Number(item.total_contract_value) })),
    commissions: commissions.map((item) => ({ ...item,
      commission_percentage: Number(item.commission_percentage),
      commission_amount: Number(item.commission_amount) })),
    closings, ...details, audit,
  };
}
