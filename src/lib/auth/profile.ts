import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "./roles";

export type CurrentProfile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  office_id: string | null;
  is_office_admin: boolean;
};

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, active, office_id, is_office_admin")
    .eq("id", claims.claims.sub)
    .single();

  if (error || !data || !isRole(data.role)) return null;
  return data as CurrentProfile;
}

export async function requireOfficeAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active || !profile.office_id) redirect("/acesso-pendente");
  if (!profile.is_office_admin) redirect("/app");
  return profile;
}

export async function requireRole(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active || !profile.office_id) redirect("/acesso-pendente");
  if (profile.role !== role) redirect("/app");
  return profile;
}
