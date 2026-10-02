"use server";

import { createClient } from "@/lib/supabase/server";

type RecoveryState = { error: string | null; success: string | null };

export async function requestPasswordReset(_state: RecoveryState, form: FormData): Promise<RecoveryState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Informe um e-mail válido.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    console.warn("Falha ao solicitar recuperação de senha", { code: error.code, status: error.status });
    return { error: "Não foi possível enviar agora. Tente novamente em alguns minutos.", success: null };
  }
  return { error: null, success: "Se este e-mail estiver cadastrado, você receberá um link para definir a senha." };
}
