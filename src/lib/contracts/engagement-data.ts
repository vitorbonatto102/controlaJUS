import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContractEngagement } from "./engagement";

export async function loadContractEngagements(ids: string[]) {
  const result = new Map<string, ContractEngagement>();
  if (!ids.length) return result;
  const supabase = await createClient();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.from("contracts").select("id,engagement_status,closed_on,updated_at")
      .in("id", ids.slice(start, start + 200));
    if (error && ["42703", "PGRST204"].includes(error.code) && /engagement_status|closed_on/.test(error.message)) return result;
    if (error) throw new Error("Não foi possível consultar a confirmação das contratações.");
    for (const row of data ?? []) result.set(row.id, row as ContractEngagement);
  }
  return result;
}
