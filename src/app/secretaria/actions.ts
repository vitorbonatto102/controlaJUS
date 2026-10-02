"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/profile";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { formatDateBR } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";

export type SecretaryActionState = ActionState;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string { return String(form.get(name) ?? "").trim(); }
function validDate(value: string): boolean {
  try { formatDateBR(value); return true; } catch { return false; }
}
function refresh(clientId: string) {
  revalidatePath("/secretaria");
  revalidatePath(`/secretaria/clientes/${clientId}`);
  revalidatePath("/advogada");
  revalidatePath("/advogada/contratos", "layout");
}

export async function registerPayment(_state: SecretaryActionState, form: FormData): Promise<SecretaryActionState> {
  await requireRole("secretary");
  const installmentId = field(form, "installment_id");
  const clientId = field(form, "client_id");
  const date = field(form, "payment_date");
  const amountCents = parseMoneyBR(field(form, "amount_paid"));
  const observation = field(form, "observation");
  if (!uuidPattern.test(installmentId) || !uuidPattern.test(clientId) || !validDate(date) ||
      !amountCents || amountCents > 99999999999999 || observation.length > 1000) {
    return { error: "Confira a parcela, a data, o valor e a observação.", success: null };
  }
  const supabase = await createClient();
  const { data: installment, error: lookupError } = await supabase.from("installments")
    .select("id, contracts!inner(client_id)").eq("id", installmentId).maybeSingle();
  const relation = installment?.contracts as unknown as { client_id: string } | null;
  if (lookupError || relation?.client_id !== clientId) {
    return { error: "Parcela não pertence a este cliente.", success: null };
  }
  const { error } = await supabase.from("payments").insert({
    installment_id: installmentId, payment_date: date, amount_paid: amountCents / 100,
    observation: observation || null,
  });
  if (error) return { error: "Não foi possível registrar o pagamento. Confira os dados e tente novamente.", success: null };
  refresh(clientId);
  return { error: null, success: "Pagamento registrado. Os valores foram atualizados." };
}

export async function addCollectionNote(_state: SecretaryActionState, form: FormData): Promise<SecretaryActionState> {
  await requireRole("secretary");
  const clientId = field(form, "client_id");
  const contractId = field(form, "contract_id");
  const installmentId = field(form, "installment_id");
  const type = field(form, "note_type");
  const content = field(form, "content");
  if (!uuidPattern.test(clientId) || (contractId && !uuidPattern.test(contractId)) ||
      (installmentId && !uuidPattern.test(installmentId)) || (installmentId && !contractId) ||
      !["collection", "client_reply", "renegotiation", "general"].includes(type) ||
      content.length < 2 || content.length > 3000) {
    return { error: "Confira o tipo, o vínculo e o texto da anotação.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("collection_notes").insert({
    client_id: clientId, contract_id: contractId || null,
    installment_id: installmentId || null, note_type: type, content,
  });
  if (error) return { error: "Não foi possível salvar a anotação.", success: null };
  refresh(clientId);
  return { error: null, success: "Anotação adicionada ao histórico." };
}

export async function revisePayment(_state: SecretaryActionState, form: FormData): Promise<SecretaryActionState> {
  await requireRole("secretary");
  const paymentId = field(form, "payment_id");
  const clientId = field(form, "client_id");
  const reason = field(form, "reason");
  const mode = field(form, "mode");
  const date = field(form, "payment_date");
  const cents = parseMoneyBR(field(form, "amount_paid"));
  if (!uuidPattern.test(paymentId) || !uuidPattern.test(clientId) || reason.length < 5 ||
      reason.length > 1000 || !["replace", "void"].includes(mode) ||
      (mode === "replace" && (!validDate(date) || !cents || cents > 99999999999999))) {
    return { error: "Informe motivo e, para corrigir, nova data e novo valor válidos.", success: null };
  }
  const supabase = await createClient();
  const { data: payment, error: lookupError } = await supabase.from("payments")
    .select("id, installments!inner(contracts!inner(client_id))")
    .eq("id", paymentId).maybeSingle();
  const installment = payment?.installments as unknown as { contracts: { client_id: string } } | null;
  if (lookupError || installment?.contracts?.client_id !== clientId) {
    return { error: "Pagamento não pertence a este cliente.", success: null };
  }
  const { error } = await supabase.rpc("revise_secretary_payment", {
    p_payment_id: paymentId, p_reason: reason,
    p_new_amount_cents: mode === "replace" ? cents : null,
    p_new_date: mode === "replace" ? date : null,
  });
  if (error) return { error: "Correção recusada. Verifique se o lançamento é seu, está ativo e não pertence a um mês fechado.", success: null };
  refresh(clientId);
  return { error: null, success: mode === "replace" ? "Pagamento corrigido com histórico." : "Pagamento estornado com histórico." };
}
