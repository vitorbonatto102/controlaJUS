"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { homeByRole, type Role } from "@/lib/auth/roles";

export function DashboardNav({ role, isAdmin }: { role: Role; isAdmin: boolean }) {
  const pathname = usePathname();
  const links = [{ href: homeByRole[role], label: "Visão geral", icon: "overview" }];
  if (role === "lawyer") links.push({ href: "/advogada/contratos", label: "Contratos", icon: "contracts" });
  if (role === "lawyer") links.push({ href: "/advogada/carteira", label: "Carteira", icon: "wallet" });
  links.push({ href: "/acompanhamento", label: "Acompanhamento", icon: "follow-up" });
  if (role === "lawyer") links.push({ href: "/advogada/notificacoes", label: "Notificações", icon: "notifications" });
  if (isAdmin) links.push({ href: "/administracao", label: "Administração", icon: "settings" });
  return <nav className="sidebar-nav" aria-label="Navegação principal">
    <p className="nav-section-label">PLATAFORMA</p>
    {links.map(({ href, label, icon }) => {
      const active = pathname === href || (href === "/administracao" && pathname.startsWith("/admin/")) ||
        (href === "/advogada/contratos" && pathname.startsWith("/advogada/contratos/"));
      return <Link key={href} href={href} className={active ? "nav-active" : "sidebar-link"}
        aria-current={active ? "page" : undefined}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon === "overview" ? <><rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" /></> : icon === "notifications" ? <>
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" />
            </> : icon === "wallet" ? <><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v11H6a3 3 0 0 1-3-3V6" />
              <path d="M20 12h-5v5h5M17 14.5h.01" /></> : <><rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 8h8M8 12h4M8 16h8" /></>}
        </svg>{label}</Link>;
    })}
  </nav>;
}
