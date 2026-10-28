import { signOut } from "@/app/actions";
import { roleLabel } from "@/lib/auth/roles";
import type { CurrentProfile } from "@/lib/auth/profile";
import { loadOfficeBrand } from "@/lib/offices/data";
import { RepassumLogo } from "./brand";
import { DashboardNav } from "./dashboard-nav";
import { OfficeIdentity } from "./office-identity";
import Link from "next/link";
import { QuickSearch, type QuickSearchItem } from "./overview/quick-search";
import { OverviewIcon } from "./overview/overview-icon";
import commandStyles from "./overview/shell.module.css";

export async function DashboardShell({ profile, children, commandCenter }: {
  profile: CurrentProfile;
  children: React.ReactNode;
  commandCenter?: { unreadCount: number; contracts: QuickSearchItem[] };
}) {
  const office = profile.office_id ? await loadOfficeBrand(profile.office_id) : null;
  return <div className={`app-shell${commandCenter ? ` ${commandStyles.shell}` : ""}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><RepassumLogo light={!!commandCenter} /><span>GESTÃO FINANCEIRA JURÍDICA</span></div>
      {office && <OfficeIdentity office={office} />}
      <DashboardNav role={profile.role} isAdmin={profile.is_office_admin} />
      <div className="sidebar-footer"><span>{roleLabel[profile.role]}{profile.is_office_admin ? " · Admin" : ""}</span><strong>{profile.full_name}</strong></div>
    </aside>
    <div className="app-content">
      <header className="topbar">{commandCenter ? <><QuickSearch items={commandCenter.contracts} />
        <div className={commandStyles.headerActions}>
          <Link href="/advogada/notificacoes" className={commandStyles.notification}
            aria-label={`Notificações${commandCenter.unreadCount ? `: ${commandCenter.unreadCount} não lidas` : ""}`}>
            <OverviewIcon name="bell" />{commandCenter.unreadCount > 0 && <i aria-hidden="true" />}</Link>
          <div className={commandStyles.user}><span aria-hidden="true">{profile.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
            <div><strong>{profile.full_name}</strong><small>{roleLabel[profile.role]}</small></div></div>
          <form action={signOut}><button className="text-button" type="submit">Sair <span aria-hidden="true">↗</span></button></form>
        </div></> : <><span className="workspace-label"><span className="workspace-dot" aria-hidden="true" />
          {office?.name ?? "Área interna"}</span><form action={signOut}><button className="text-button" type="submit">Sair da conta <span aria-hidden="true">↗</span></button></form></>}</header>
      <main className="dashboard-main">{children}</main>
    </div>
  </div>;
}
