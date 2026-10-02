import { signOut } from "@/app/actions";
import Link from "next/link";
import { roleLabel } from "@/lib/auth/roles";
import type { CurrentProfile } from "@/lib/auth/profile";

export function DashboardShell({ profile, children }: {
  profile: CurrentProfile;
  children: React.ReactNode;
}) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark">CJ</span><span>ControlaJUS</span></div>
      <div className="sidebar-nav"><Link className="nav-active" href={
        profile.role === "lawyer" ? "/advogada" : profile.role === "manager" ? "/gestor" :
          profile.role === "admin" ? "/administracao" : "/secretaria"
      }>Visão geral</Link>{profile.role === "lawyer" && <Link className="sidebar-link" href="/advogada/notificacoes">🔔 Notificações</Link>}</div>
      <div className="sidebar-footer"><span>{roleLabel[profile.role]}</span><strong>{profile.full_name}</strong></div>
    </aside>
    <div className="app-content">
      <header className="topbar"><span>Área interna</span><form action={signOut}><button className="text-button" type="submit">Sair</button></form></header>
      <main className="dashboard-main">{children}</main>
    </div>
  </div>;
}
