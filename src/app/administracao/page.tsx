import { DashboardShell } from "@/components/dashboard-shell";
import { AdminUsers, type AdminUser } from "@/components/admin-users";
import { updateUser } from "@/app/administracao/actions";
import { requireOfficeAdmin } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const profile = await requireOfficeAdmin();
  const supabase = await createClient();
  const { data: office } = profile.office_id ? await supabase.from("offices")
    .select("name").eq("id", profile.office_id).single() : { data: null };
  const users: AdminUser[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("profiles")
      .select("id,full_name,email,role,active,is_office_admin,created_at")
      .order("created_at", { ascending: false }).range(offset, offset + 199);
    if (error) throw new Error("Não foi possível carregar os usuários.");
    users.push(...(data ?? []).map((user) => ({
      ...user,
      updateAction: updateUser.bind(null, user.id),
    })) as AdminUser[]);
    if (!data || data.length < 200) break;
  }
  return <DashboardShell profile={profile}>
    <p className="eyebrow">ADMINISTRAÇÃO</p><h1>Olá, {profile.full_name}</h1>
    <p className="page-description">{office?.name ?? "Seu escritório"} · Convide pessoas, defina cargos e conceda acesso administrativo. Os convites ficam vinculados a este escritório.</p>
    <AdminUsers users={users} />
  </DashboardShell>;
}
