"use server";

import { revalidatePath } from "next/cache";
import { requireOfficeAdmin } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { validGoalMonth } from "@/lib/goals/model";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function saveOfficeGoal(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireOfficeAdmin();
  const month = String(form.get("month") ?? "");
  const raw = String(form.get("target") ?? "").trim();
  const target = Number(raw);
  if (!validGoalMonth(month, todayInSaoPaulo().slice(0, 7)) || !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(target) || target < 1 || target > 10000)
    return { error: "Confira o mês e informe de 1 a 10.000 contratos.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_office_contract_goal", { p_month: `${month}-01`, p_target: target });
  if (error) return { error: "Não foi possível salvar a meta do escritório. Confira suas permissões ou tente novamente.", success: null };
  revalidatePath("/metas");
  return { error: null, success: "Meta do escritório atualizada." };
}
