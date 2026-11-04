import "server-only";
import { createClient } from "@/lib/supabase/server";
export type PayoutItem = { contract_id: string; client_name: string; origin: string; service_name: string | null;
  recipient: "lawyer" | "commercial"; amount: number; paid: number; balance: number; overpaid: number; due_date: string };
export type PayoutAgenda = { closing_id: string; items: PayoutItem[]; unallocated_transfers: { id: string; amount: number; payment_date: string }[];
  commercial_transfers?: { id: string; contract_id: string; amount: number; payment_date: string; notes: string | null; reversed_at: string | null; reversal_reason: string | null }[] };
export async function loadPayoutAgenda(id: string): Promise<PayoutAgenda | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("closing_payout_agenda", { p_closing: id });
  if (error?.code === "PGRST202") return null;
  if (error || !data) throw new Error("Não foi possível consultar a agenda de repasses. Confira a composição e os ajustes do fechamento.");
  return data as PayoutAgenda;
}
