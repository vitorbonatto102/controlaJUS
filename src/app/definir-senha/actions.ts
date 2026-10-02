"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
type PasswordActionState = { error: string | null; success: string | null };

export async function setInitialPassword(_state: PasswordActionState, form: FormData): Promise<PasswordActionState> {
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  if (password.length < 6 || password.length > 128 || password !== confirmation) {
    return { error: "Use uma senha de pelo menos 6 caracteres e confirme-a corretamente.", success: null };
  }
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return { error: "Convite expirado. Solicite um novo link.", success: null };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: `O Supabase recusou a senha: ${error.message}`, success: null };
  redirect("/app");
}
