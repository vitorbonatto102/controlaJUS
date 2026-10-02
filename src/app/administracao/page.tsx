import { DashboardShell } from "@/components/dashboard-shell";
import { AdminUsers, type AdminUser } from "@/components/admin-users";
import { requireRole } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const users: AdminUser[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("profiles")
      .select("id,full_name,email,role,active,created_at")
      .order("created_at", { ascending: false }).range(offset, offset + 199);
    if (error) throw new Error("Não foi possível carregar os usuários.");
    users.push(...(data ?? []) as AdminUser[]);
    if (!data || data.length < 200) break;
  }
  return <DashboardShell profile={profile}>
    <p className="eyebrow">ADMINISTRAÇÃO</p><h1>Olá, {profile.full_name}</h1>
    <p className="page-description">Convide pessoas, defina perfis e controle o acesso ao escritório.</p>
    <AdminUsers users={users} />
  </DashboardShell>;
}
