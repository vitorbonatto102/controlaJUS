"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type RecoveryConfirmState = { error: string | null };

export async function confirmRecovery(_state: RecoveryConfirmState, form: FormData): Promise<RecoveryConfirmState> {
  const tokenHash = form.get("token_hash");
  if (typeof tokenHash !== "string" || tokenHash.length < 20 || tokenHash.length > 512) {
    return { error: "Link inválido. Solicite outro na página de recuperação." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error) {
    console.warn("Falha ao confirmar recuperação", { code: error.code, status: error.status });
    return { error: "Este link expirou ou já foi usado. Solicite outro na página de recuperação." };
  }
  redirect("/definir-senha");
}
