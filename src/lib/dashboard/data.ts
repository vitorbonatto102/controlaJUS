import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MonthlyContractGoal } from "./goals";

export async function loadMonthlyContractGoal(lawyerId: string, month: string): Promise<{
  goal: MonthlyContractGoal | null; available: boolean;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("lawyer_monthly_goals")
    .select("reference_month,target_contract_count,updated_at")
    .eq("lawyer_id", lawyerId).eq("reference_month", `${month}-01`).maybeSingle();
  // The rest of the dashboard remains usable between deployment and migration.
  if (error && ["42P01", "PGRST205"].includes(error.code) && error.message.includes("lawyer_monthly_goals"))
    return { goal: null, available: false };
  if (error) throw new Error("Não foi possível consultar sua meta mensal.");
  return { goal: data as MonthlyContractGoal | null, available: true };
}
