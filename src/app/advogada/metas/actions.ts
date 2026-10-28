"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/profile";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

export async function saveContractGoal(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("lawyer");
  const month = String(form.get("month") ?? "");
  const rawTarget = String(form.get("target") ?? "").trim();
  const target = Number(rawTarget);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d+$/.test(rawTarget) ||
    !Number.isSafeInteger(target) || target < 1 || target > 10000)
    return { error: "Informe uma meta entre 1 e 10.000 contratos para um mês válido.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_my_contract_goal", {
    p_month: `${month}-01`, p_target: target,
  });
  if (error) return { error: "Não foi possível salvar a meta. Tente novamente ou procure o administrador.", success: null };
  revalidatePath("/advogada");
  return { error: null, success: "Meta mensal atualizada." };
}
