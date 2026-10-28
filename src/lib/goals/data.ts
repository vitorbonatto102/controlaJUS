import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GoalScope, GoalSummary } from "./model";

export async function loadGoalSummary(scope: GoalScope, month: string): Promise<GoalSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contract_goal_summary", { p_scope: scope, p_month: `${month}-01` });
  if (error?.code === "PGRST202") return null;
  if (error) throw new Error("Não foi possível consultar o progresso das metas.");
  if (!data) throw new Error("Resumo de metas indisponível.");
  return data as GoalSummary;
}

export async function loadUnconfirmedContracts(lawyerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contracts")
    .select("id,service_name,contract_date,clients!contracts_client_id_fkey(full_name)")
    .eq("lawyer_id", lawyerId).eq("engagement_status", "unconfirmed").is("deleted_at", null)
    .order("contract_date", { ascending: false }).order("id").limit(6);
  if (error) throw new Error("Não foi possível consultar as contratações aguardando confirmação.");
  return (data ?? []).map((item) => {
    const client = item.clients as unknown as { full_name: string } | { full_name: string }[] | null;
    return { id: item.id as string, service: item.service_name as string | null,
      clientName: (Array.isArray(client) ? client[0] : client)?.full_name ?? "Cliente",
      documentDate: item.contract_date as string };
  });
}
