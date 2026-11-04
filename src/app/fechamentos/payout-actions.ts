"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { brazilianToIso } from "@/lib/contracts/registration";
import { isReportId } from "@/lib/reports/model";
import type { ActionState } from "@/lib/action-state";
import { PERCENTAGES } from "@/lib/contracts/validation";

function refresh(id: string) {
  for (const path of ["/gestor", "/advogada", "/advogada/carteira", "/advogada/fechamentos", "/notificacoes", "/advogada/notificacoes", `/fechamentos/${id}`]) revalidatePath(path);
}
export async function recordScheduledTransfer(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("manager");
  const read = (key: string) => String(form.get(key) ?? "").trim();
  const closing = read("closing"), contract = read("contract"), recipient = read("recipient"), existing = read("existing"), notes = read("notes");
  const amount = parseMoneyBR(read("amount")); let date: string | null = null;
  try { if (!existing) date = brazilianToIso(read("date")); } catch { return { error: "Informe a data real em DD/MM/AAAA.", success: null }; }
  if (!isReportId(closing) || !isReportId(contract) || !["lawyer", "commercial"].includes(recipient) || (existing && !isReportId(existing)) ||
    !amount || amount > 99999999999999 || notes.length > 1000 || (existing && notes.length < 5)) return { error: "Confira valor, registro e observação.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_scheduled_transfer", { p_closing: closing, p_contract: contract, p_recipient: recipient,
    p_amount_cents: amount, p_date: date, p_notes: notes, p_existing_transfer: existing || null });
  if (error) return { error: error.code === "P0001" ? error.message : "Não foi possível registrar o repasse.", success: null };
  refresh(closing); return { error: null, success: existing ? "Repasse existente vinculado, sem criar novo pagamento." : "Repasse registrado e vinculado ao contrato." };
}
export async function revisePayoutDate(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("manager");
  const id = String(form.get("closing") ?? ""), contract = String(form.get("contract") ?? ""), reason = String(form.get("reason") ?? "").trim();
  let date: string;
  try { date = brazilianToIso(String(form.get("date") ?? "")); } catch { return { error: "Informe a data em DD/MM/AAAA.", success: null }; }
  if (!isReportId(id) || !isReportId(contract) || reason.length < 5 || reason.length > 1000) return { error: "Confira o contrato e o motivo.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revise_payout_date", { p_closing: id, p_contract: contract, p_date: date, p_reason: reason });
  if (error) return { error: "Não foi possível revisar a previsão do repasse.", success: null };
  refresh(id); return { error: null, success: "Previsão revisada com histórico e notificação." };
}
export async function savePayoutTerms(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("manager");
  const contract = String(form.get("contract") ?? ""), commercial = Number(form.get("commercial"));
  const reason = String(form.get("reason") ?? "").trim(), mode=String(form.get("mode")??"");
  const distribution=mode === "upfront" ? String(form.get("distribution")??"") : null;
  const limit=distribution === "shared" ? parseMoneyBR(String(form.get("thirdLimit")??"")) : null;
  const commercialRecipientName = String(form.get("commercialRecipientName") ?? "").trim();
  if (!isReportId(contract) || (commercial !== 0 && !PERCENTAGES.some(item => item === commercial)) || reason.length < 5 || reason.length > 1000 ||
    !["upfront","proportional"].includes(mode) || (mode === "upfront" && !["lawyer_only","shared"].includes(distribution ?? "")) ||
    (distribution === "shared" && (!limit || limit>99999999999999)) ||
    ((commercial > 0 || distribution === "shared") && (commercialRecipientName.length < 2 || commercialRecipientName.length > 160)))
    return { error: "Confira a destinação, os valores e o motivo.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_contract_distribution", { p_contract: contract, p_commercial: commercial,
    p_distribution:distribution,p_limit:limit === null ? null : limit/100,p_name: commercialRecipientName || null, p_reason: reason });
  if (error?.code === "PGRST202") return { error: "Peça ao administrador para aplicar a atualização de retenção e terceiros no Supabase.", success: null };
  if (error) return { error: error.code === "P0001" ? error.message : "Não foi possível revisar as condições.", success: null };
  revalidatePath("/gestor"); revalidatePath("/advogada/carteira"); revalidatePath("/advogada/contratos", "layout"); revalidatePath("/fechamentos", "layout");
  return { error: null, success: "Destinação atualizada. Participações e ajustes foram recalculados com histórico e notificação." };
}
export async function reverseCommercialTransfer(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("manager");
  const id = String(form.get("id") ?? ""), closing = String(form.get("closing") ?? ""), reason = String(form.get("reason") ?? "").trim();
  if (!isReportId(id) || !isReportId(closing) || reason.length < 5 || reason.length > 1000) return { error: "Informe o motivo do estorno.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_commercial_transfer", { p_transfer: id, p_reason: reason });
  if (error) return { error: "Não foi possível estornar o repasse comercial.", success: null };
  refresh(closing); return { error: null, success: "Repasse comercial estornado com histórico." };
}
