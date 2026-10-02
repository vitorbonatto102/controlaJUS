"use server";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/profile";
import { isRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type AdminActionState = { error: string | null; success: string | null };
export const emptyAdminState: AdminActionState = { error: null, success: null };
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function inviteUser(_state: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireRole("admin");
  const name = field(form, "full_name");
  const email = field(form, "email").toLocaleLowerCase("en-US");
  const role = field(form, "role");
  if (name.length < 2 || name.length > 160 || !emailPattern.test(email) || email.length > 254 || !isRole(role)) {
    return { error: "Confira nome, e-mail e perfil.", success: null };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return { error: "Configure SUPABASE_SECRET_KEY no servidor para enviar convites.", success: null };
  const admin = createAdminClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name },
  });
  if (error || !data.user) return { error: "Não foi possível enviar o convite. Confira o e-mail e a configuração do Auth.", success: null };
  const supabase = await createClient();
  const { error: profileError } = await supabase.rpc("admin_update_profile", {
    p_user: data.user.id, p_name: name, p_role: role, p_active: true,
    p_reason: "Convite administrativo de novo usuário",
  });
  if (profileError) return { error: "Convite enviado, mas o perfil permaneceu pendente. Abra a lista e ative o usuário após conferir os dados.", success: null };
  revalidatePath("/administracao");
  revalidatePath("/admin/users");
  return { error: null, success: "Convite enviado. A pessoa definirá a própria senha pelo link recebido." };
}

export async function updateUser(_state: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireRole("admin");
  const id = field(form, "user_id");
  const name = field(form, "full_name");
  const role = field(form, "role");
  const active = field(form, "active") === "true";
  const reason = field(form, "reason");
  if (!uuid.test(id) || name.length < 2 || name.length > 160 || !isRole(role) ||
    reason.length < 5 || reason.length > 1000 || field(form, "confirm") !== "yes") {
    return { error: "Confira os dados, confirme a mudança e informe um motivo.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_profile", {
    p_user: id, p_name: name, p_role: role, p_active: active, p_reason: reason,
  });
  if (error) return { error: "Alteração recusada. Preserve pelo menos um admin e o perfil de advogadas com histórico financeiro.", success: null };
  revalidatePath("/administracao");
  revalidatePath("/admin/users");
  return { error: null, success: "Usuário atualizado com auditoria." };
}
