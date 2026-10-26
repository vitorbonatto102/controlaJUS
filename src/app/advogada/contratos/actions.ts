"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContract } from "@/lib/contracts/data";
import { contractHasPayments, parseEditValues, prepareContractEdit } from "@/lib/contracts/editing";
import { hasInstallmentNotes } from "@/lib/contracts/management-data";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
function refresh(contractId: string, clientId: string) {
  for (const path of ["/advogada", "/advogada/carteira", "/advogada/contratos", `/advogada/contratos/${contractId}`,
    `/advogada/contratos/${contractId}/editar`, "/acompanhamento", "/secretaria", `/secretaria/clientes/${clientId}`, "/gestor"]) revalidatePath(path);
}
function message(error: { code?: string; message: string }) {
  if (error.code === "PGRST202") return "Peça ao administrador para aplicar a atualização das formas de comissão no Supabase.";
  if (error.code === "P0001") return error.message;
  return "Não foi possível salvar. Confira os dados e tente novamente.";
}

export async function saveLawyerContract(_state: ActionState, form: FormData): Promise<ActionState> {
  const profile = await requireRole("lawyer");
  const id = field(form, "contract_id");
  const version = field(form, "version");
  const reason = field(form, "reason");
  if (!uuid.test(id) || !version || !Number.isFinite(Date.parse(version)) || reason.length < 5 || reason.length > 1000)
    return { error: "Confira o contrato e informe um motivo com pelo menos 5 caracteres.", success: null };
  const contract = await loadLawyerContract(profile.id, id);
  if (!contract) return { error: "Contrato indisponível.", success: null };
  const locked = contractHasPayments(contract) || await hasInstallmentNotes(id);
  const metadataOnly = field(form, "metadata_only") === "yes";
  if (locked && !metadataOnly) return { error: "Este contrato recebeu novos lançamentos. Recarregue a página antes de editar.", success: null };
  let prepared: ReturnType<typeof prepareContractEdit>;
  try {
    const values = parseEditValues(JSON.parse(field(form, "values")));
    prepared = prepareContractEdit(values, metadataOnly);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Confira os dados informados.", success: null };
  }
  const path = field(form, "file_path");
  const name = field(form, "file_name");
  if ((!!path !== !!name) || name.length > 255 || path.length > 500)
    return { error: "Confira o arquivo PDF.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_lawyer_contract_v2", {
    p_contract_id: id, p_expected_updated_at: version, p_reason: reason,
    p_changes: { ...prepared.changes, ...(path ? { contract_file_path: path, contract_file_name: name } : {}) },
    p_schedule: prepared.schedule,
  });
  if (error) return { error: message(error), success: null };
  refresh(id, contract.client_id);
  return { error: null, success: "Contrato atualizado com histórico de alterações." };
}

export async function deleteLawyerContract(_state: ActionState, form: FormData): Promise<ActionState> {
  const profile = await requireRole("lawyer");
  const id = field(form, "contract_id");
  const version = field(form, "version");
  const reason = field(form, "reason");
  if (!uuid.test(id) || !version || !Number.isFinite(Date.parse(version)) || reason.length < 5 || reason.length > 1000 || form.get("confirm") !== "yes")
    return { error: "Informe o motivo e confirme a exclusão.", success: null };
  const contract = await loadLawyerContract(profile.id, id);
  if (!contract) return { error: "Contrato indisponível.", success: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_lawyer_contract", {
    p_contract_id: id, p_expected_updated_at: version, p_reason: reason,
  });
  if (error) return { error: message(error), success: null };
  refresh(id, contract.client_id);
  redirect("/advogada/contratos?excluido=1");
}
