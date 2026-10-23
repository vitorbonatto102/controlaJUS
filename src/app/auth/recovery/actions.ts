"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseRecoveryProof } from "@/lib/auth/recovery";

type RecoveryConfirmState = { error: string | null };

export async function confirmRecovery(_state: RecoveryConfirmState, form: FormData): Promise<RecoveryConfirmState> {
  const proof = parseRecoveryProof({ tokenHash: form.get("token_hash"), code: form.get("code"), type: "recovery" });
  if (!proof) {
    return { error: "Link inválido. Solicite outro na página de recuperação." };
  }
  const supabase = await createClient();
  // The custom template supplies a token hash; Supabase's default template
  // supplies a PKCE code. Neither credential is consumed on a page GET.
  const { error } = proof.kind === "token_hash" ?
    await supabase.auth.verifyOtp({ token_hash: proof.value, type: "recovery" }) :
    await supabase.auth.exchangeCodeForSession(proof.value);
  if (error) {
    console.warn("Falha ao confirmar recuperação", { code: error.code, status: error.status });
    if (proof.kind === "code" && ["bad_code_verifier", "flow_state_not_found", "flow_state_expired", "pkce_code_verifier_not_found"].includes(error.code ?? ""))
      return { error: "Solicite outro link e abra-o no mesmo navegador em que pediu a recuperação." };
    return { error: "Não foi possível confirmar este link. Ele pode ter expirado ou já ter sido usado. Solicite outro na página de recuperação." };
  }
  redirect("/definir-senha");
}
