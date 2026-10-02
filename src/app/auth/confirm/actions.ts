"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type InviteActionState = { error: string | null };

export async function acceptInvite(_state: InviteActionState, form: FormData): Promise<InviteActionState> {
  const tokenHash = form.get("token_hash");
  if (typeof tokenHash !== "string" || tokenHash.length < 20 || tokenHash.length > 512) {
    return { error: "Link inválido. Solicite um novo convite ao administrador." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
  if (error) {
    // Não registrar o token: ele é uma credencial de uso único.
    console.warn("Falha ao aceitar convite", { code: error.code, status: error.status });
    return { error: error.code === "invite_not_found" || error.code === "otp_expired"
      ? "Este convite expirou ou já foi usado. Solicite um novo convite ao administrador."
      : "Não foi possível confirmar o convite. Confira o projeto Supabase e solicite um novo link." };
  }
  redirect("/definir-senha");
}
