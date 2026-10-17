import { signOut } from "@/app/actions";
import { roleLabel } from "@/lib/auth/roles";
import type { CurrentProfile } from "@/lib/auth/profile";
import { loadOfficeBrand } from "@/lib/offices/data";
import { RepassumLogo } from "./brand";
import { DashboardNav } from "./dashboard-nav";
import { OfficeIdentity } from "./office-identity";

export async function DashboardShell({ profile, children }: {
  profile: CurrentProfile;
  children: React.ReactNode;
}) {
  const office = profile.office_id ? await loadOfficeBrand(profile.office_id) : null;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><RepassumLogo /><span>GESTÃO FINANCEIRA JURÍDICA</span></div>
      {office && <OfficeIdentity office={office} />}
      <DashboardNav role={profile.role} isAdmin={profile.is_office_admin} />
      <div className="sidebar-footer"><span>{roleLabel[profile.role]}{profile.is_office_admin ? " · Admin" : ""}</span><strong>{profile.full_name}</strong></div>
    </aside>
    <div className="app-content">
      <header className="topbar"><span className="workspace-label"><span className="workspace-dot" aria-hidden="true" />
        {office?.name ?? "Área interna"}</span><form action={signOut}><button className="text-button" type="submit">Sair da conta <span aria-hidden="true">↗</span></button></form></header>
      <main className="dashboard-main">{children}</main>
    </div>
  </div>;
}
