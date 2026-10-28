import { DashboardShell } from "@/components/dashboard-shell";
import { AdminUsers, type AdminUser } from "@/components/admin-users";
import { updateUser } from "@/app/administracao/actions";
import { requireOfficeAdmin } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { loadOfficeBrand } from "@/lib/offices/data";
import { OfficeIdentity } from "@/components/office-identity";
import { OfficeLogoForm } from "@/components/office-logo-form";
import { loadUserAvatars } from "@/lib/users/avatar-data";
import { updateUserAvatar } from "./avatar-actions";

export default async function AdminPage() {
  const profile = await requireOfficeAdmin();
  const supabase = await createClient();
  const office = profile.office_id ? await loadOfficeBrand(profile.office_id) : null;
  const users: AdminUser[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("profiles")
      .select("id,full_name,email,role,active,is_office_admin,created_at")
      .order("created_at", { ascending: false }).range(offset, offset + 199);
    if (error) throw new Error("Não foi possível carregar os usuários.");
    users.push(...(data ?? []).map((user) => ({
      ...user,
      avatarPath: null, avatarUrl: null,
      avatarAction: updateUserAvatar.bind(null, user.id),
      updateAction: updateUser.bind(null, user.id),
    })) as AdminUser[]);
    if (!data || data.length < 200) break;
  }
  const photos = await loadUserAvatars(profile.office_id!, users.map((user) => user.id));
  for (const user of users) {
    const photo = photos.byUser.get(user.id);
    user.avatarPath = photo?.path ?? null;
    user.avatarUrl = photo?.url ?? null;
  }
  return <DashboardShell profile={profile}>
    <p className="eyebrow">ADMINISTRAÇÃO</p><h1>Olá, {profile.full_name}</h1>
    <p className="page-description">{office?.name ?? "Seu escritório"} · Convide pessoas, defina cargos e conceda acesso administrativo. Os convites ficam vinculados a este escritório.</p>
    {office && <section className="workspace-panel office-branding-panel" aria-labelledby="office-brand-title">
      <div><p className="eyebrow">IDENTIDADE DO ESCRITÓRIO</p><h2 id="office-brand-title">O seu espaço na Repassum</h2>
        <p>O nome e o logo identificam o ambiente de toda a sua equipe.</p><OfficeIdentity office={office} /></div>
      {office.brandingReady ? <OfficeLogoForm hasLogo={Boolean(office.logoUrl)} />
        : <p>A personalização ainda não foi habilitada. Contate o administrador da plataforma.</p>}
    </section>}
    <AdminUsers users={users} photosReady={photos.ready} photosError={photos.error} />
  </DashboardShell>;
}
