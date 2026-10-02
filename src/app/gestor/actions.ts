"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/profile";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { formatDateBR } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";

export type ManagerActionState = { error: string | null; success: string | null };
export const emptyManagerState: ManagerActionState = { error: null, success: null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const validDate = (date: string) => { try { formatDateBR(date); return true; } catch { return false; } };
function refresh() {
  revalidatePath("/gestor");
  revalidatePath("/advogada");
  revalidatePath("/advogada/notificacoes");
  revalidatePath("/advogada/contratos", "layout");
}

export async function confirmClosing(_state: ManagerActionState, form: FormData): Promise<ManagerActionState> {
  await requireRole("manager");
  const lawyer = value(form, "lawyer_id");
  const month = Number(value(form, "month"));
  const year = Number(value(form, "year"));
  if (!uuid.test(lawyer) || !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(year) || year < 2000 || year > 9999 || value(form, "confirm") !== "yes") {
    return { error: "Confira a advogada, o período e a confirmação.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_monthly_closing", {
    p_lawyer: lawyer, p_month: month, p_year: year,
  });
  if (error) return { error: "Não foi possível confirmar. Confira o período, o prazo e se já existe fechamento.", success: null };
  refresh();
  return { error: null, success: "Fechamento confirmado com composição preservada." };
}

export async function registerTransfer(_state: ManagerActionState, form: FormData): Promise<ManagerActionState> {
  await requireRole("manager");
  const closing = value(form, "closing_id");
  const amount = parseMoneyBR(value(form, "amount"));
  const date = value(form, "payment_date");
  const notes = value(form, "notes");
  if (!uuid.test(closing) || !amount || amount > 99999999999999 || !validDate(date) || notes.length > 1000) {
    return { error: "Confira o valor, a data e a observação do repasse.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_commission_transfer", {
    p_closing: closing, p_amount_cents: amount, p_date: date, p_notes: notes,
  });
  if (error) return { error: "Repasse recusado. O valor pode superar o saldo atual; confira o fechamento.", success: null };
  refresh();
  return { error: null, success: "Repasse registrado com histórico." };
}

export async function reverseTransfer(_state: ManagerActionState, form: FormData): Promise<ManagerActionState> {
  await requireRole("manager");
  const transfer = value(form, "transfer_id");
  const reason = value(form, "reason");
  if (!uuid.test(transfer) || reason.length < 5 || reason.length > 1000) {
    return { error: "Informe o motivo da reversão.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_commission_transfer", { p_transfer: transfer, p_reason: reason });
  if (error) return { error: "Não foi possível reverter este repasse.", success: null };
  refresh();
  return { error: null, success: "Repasse revertido com auditoria." };
}

export async function correctPayment(_state: ManagerActionState, form: FormData): Promise<ManagerActionState> {
  await requireRole("manager");
  const payment = value(form, "payment_id");
  const reason = value(form, "reason");
  const mode = value(form, "mode");
  const amount = parseMoneyBR(value(form, "amount"));
  const date = value(form, "payment_date");
  if (!uuid.test(payment) || reason.length < 5 || reason.length > 1000 ||
      !["replace", "void"].includes(mode) ||
      (mode === "replace" && (!amount || amount > 99999999999999 || !validDate(date)))) {
    return { error: "Informe motivo e, para substituir, data e valor válidos.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("revise_manager_payment", {
    p_payment: payment, p_reason: reason,
    p_new_amount_cents: mode === "replace" ? amount : null,
    p_new_date: mode === "replace" ? date : null,
  });
  if (error) return { error: "Correção recusada. Confira se o pagamento ainda está ativo.", success: null };
  refresh();
  return { error: null, success: "Pagamento corrigido; auditoria e ajustes foram registrados." };
}

export async function recordLatePayment(_state: ManagerActionState, form: FormData): Promise<ManagerActionState> {
  await requireRole("manager");
  const installment = value(form, "installment_id");
  const date = value(form, "payment_date");
  const amount = parseMoneyBR(value(form, "amount"));
  const observation = value(form, "observation");
  const reason = value(form, "reason");
  if (!uuid.test(installment) || !validDate(date) || !amount || amount > 99999999999999 ||
    observation.length > 1000 || reason.length < 5 || reason.length > 1000) {
    return { error: "Confira parcela, data, valor e motivo do lançamento.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("manager_record_payment", {
    p_installment: installment, p_date: date, p_amount_cents: amount,
    p_observation: observation, p_reason: reason,
  });
  if (error) return { error: "Não foi possível registrar o lançamento complementar.", success: null };
  refresh();
  return { error: null, success: "Pagamento registrado com ajuste do fechamento e notificação." };
}

export async function correctField(_state: ManagerActionState, form: FormData): Promise<ManagerActionState> {
  await requireRole("manager");
  const table = value(form, "table");
  const record = value(form, "record_id");
  const field = value(form, "field");
  const rawNext = value(form, "new_value");
  const reason = value(form, "reason");
  const allowed: Record<string, string[]> = {
    clients: ["full_name", "cpf"], contracts: ["origin", "contract_date", "total_contract_value"],
    installments: ["due_date", "contractual_amount"],
    collection_notes: ["content", "note_type"], contract_financial_terms: ["commission_percentage"],
  };
  const moneyField = field === "total_contract_value" || field === "contractual_amount";
  const cents = moneyField ? parseMoneyBR(rawNext) : null;
  const next = moneyField && cents !== null ? (cents / 100).toFixed(2) : rawNext;
  if (!uuid.test(record) || !allowed[table]?.includes(field) || !next ||
    (moneyField && (cents === null || cents > 99999999999999)) ||
    reason.length < 5 || reason.length > 1000) {
    return { error: "Confira o novo valor e informe um motivo com pelo menos 5 caracteres.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_manager_field", {
    p_table: table, p_record: record, p_field: field, p_new: next, p_reason: reason,
  });
  if (error) return { error: "Correção recusada. Confira o valor e as regras deste campo.", success: null };
  refresh();
  return { error: null, success: "Informação corrigida com auditoria e notificação." };
}
