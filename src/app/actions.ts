"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeByRole, isRole } from "@/lib/auth/roles";

export type LoginState = { error: string };

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length === 0) {
    return { error: "Informe um e-mail válido e sua senha." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "E-mail ou senha inválidos." };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, active, office_id")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile || !profile.active || !profile.office_id || !isRole(profile.role)) {
    await supabase.auth.signOut();
    return { error: "Acesso pendente. Solicite a ativação ao administrador." };
  }

  redirect(homeByRole[profile.role]);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
