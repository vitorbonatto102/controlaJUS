import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GoalScope, GoalSummary, TeamGoalSummary } from "./model";

export async function loadGoalSummary(scope: GoalScope, month: string): Promise<GoalSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contract_goal_summary", { p_scope: scope, p_month: `${month}-01` });
  if (error?.code === "PGRST202") return null;
  if (error) throw new Error("Não foi possível consultar o progresso das metas.");
  if (!data) throw new Error("Resumo de metas indisponível.");
  if ((data as { count_basis?: string }).count_basis !== "contract_date") return null;
  return data as GoalSummary;
}

export async function loadTeamGoals(month: string): Promise<TeamGoalSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_contract_goals", { p_month: `${month}-01` });
  if (error?.code === "PGRST202") return null;
  if (error || !data || !Array.isArray(data.members)) throw new Error("Não foi possível consultar as metas da equipe.");
  return data as TeamGoalSummary;
}
