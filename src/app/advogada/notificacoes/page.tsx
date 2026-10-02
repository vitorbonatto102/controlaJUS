import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth/profile";
import { loadNotifications } from "@/lib/finance/data";
import { markNotificationRead } from "./actions";

export default async function NotificationsPage() {
  const profile = await requireRole("lawyer");
  const notifications = await loadNotifications(profile.id);
  return <DashboardShell profile={profile}>
    <Link href="/advogada" className="back-link">← Voltar ao painel</Link>
    <p className="eyebrow">CENTRAL DE NOTIFICAÇÕES</p><h1>Notificações</h1>
    <p className="page-description">Correções relacionadas aos seus contratos e recebimentos.</p>
    <section className="workspace-panel lawyer-section">
      {!notifications.length && <p>Não existem notificações.</p>}
      {notifications.map((item) => <article className="notification-item" key={item.id}>
        <div><strong>{item.title}{!item.read_at && " · Nova"}</strong>
          <p>{item.message}</p><small>{new Date(item.created_at).toLocaleString("pt-BR")}</small></div>
        {!item.read_at && <form action={markNotificationRead}>
          <input type="hidden" name="notification_id" value={item.id} />
          <button type="submit" className="secondary-button">Marcar como lida</button>
        </form>}
      </article>)}
    </section>
  </DashboardShell>;
}
