import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireActiveProfile } from "@/lib/auth/profile";
import { loadNotifications } from "@/lib/finance/data";
import { loadNotificationLinks } from "@/lib/notifications/data";
import { markNotificationRead } from "./actions";

export default async function NotificationsPage() {
  const profile = await requireActiveProfile();
  const notifications = await loadNotifications(profile.id);
  const links = await loadNotificationLinks(notifications);
  return <DashboardShell profile={profile}>
    <Link href={profile.role === "manager" ? "/gestor" : "/advogada"} className="back-link">← Voltar ao painel</Link>
    <p className="eyebrow">CENTRAL DE NOTIFICAÇÕES</p><h1>Notificações</h1>
    <p className="page-description">Recebimentos registrados, alterações e exclusões de pagamentos, cobranças e correções relacionadas aos seus contratos.</p>
    <section className="workspace-panel lawyer-section">
      {!notifications.length && <p>Não existem notificações.</p>}
      {notifications.map((item) => <article className="notification-item" key={item.id}>
        <div><strong>{item.title}{!item.read_at && " · Nova"}</strong>
          <p>{item.message}</p><small>{new Date(item.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small>
          {["automatic_closing", "closing_correction"].includes(item.type) && item.related_record_id && <p><Link href={`/fechamentos/${item.related_record_id}`}>Visualizar fechamento →</Link></p>}
          {links.has(item.id) && <p><Link className="row-link" href={links.get(item.id)!}>
            {["payout_receipt_confirmed", "payout_receipt_reversed"].includes(item.type) ? "Ver relatório e recebimento →" : item.type === "secretary_collection_note" ? "Ver anotação no contrato →" : "Ver pagamento no contrato →"}</Link></p>}</div>
        {!item.read_at && <form action={markNotificationRead}>
          <input type="hidden" name="notification_id" value={item.id} />
          <button type="submit" className="secondary-button">Marcar como lida</button>
        </form>}
      </article>)}
    </section>
  </DashboardShell>;
}
