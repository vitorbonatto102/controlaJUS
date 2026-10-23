"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { recoveryRedirectUrl } from "@/lib/auth/recovery";

type RecoveryState = { error: string | null; success: string | null };

export async function requestPasswordReset(_state: RecoveryState, form: FormData): Promise<RecoveryState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Informe um e-mail válido.", success: null };
  }
  let redirectTo: string;
  try {
    // Next validates the Server Action's Origin against its Host. Supabase
    // also validates this absolute destination against the project's allow list.
    redirectTo = recoveryRedirectUrl((await headers()).get("origin"));
  } catch {
    return { error: "Abra a recuperação pelo endereço da plataforma e tente novamente.", success: null };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.warn("Falha ao solicitar recuperação de senha", { code: error.code, status: error.status });
    return { error: "Não foi possível enviar agora. Tente novamente em alguns minutos.", success: null };
  }
  return { error: null, success: "Se este e-mail estiver cadastrado, você receberá um link para definir a senha." };
}
