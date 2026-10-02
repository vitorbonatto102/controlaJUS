import { DashboardShell } from "@/components/dashboard-shell";
import { SecretaryTable } from "@/components/secretary-table";
import { requireRole } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { formatBRL } from "@/lib/formatters";
import { loadSecretaryWorkspace } from "@/lib/secretary/data";
import { buildOperationalRows, summarizeOperations } from "@/lib/secretary/view";

export default async function SecretaryPage() {
  const profile = await requireRole("secretary");
  const { contracts, notes, lawyers } = await loadSecretaryWorkspace();
  const today = todayInSaoPaulo();
  const rows = buildOperationalRows(contracts, notes, today);
  const summary = summarizeOperations(rows, contracts, today);
  const firstName = profile.full_name.trim().split(/\s+/)[0];
  return <DashboardShell profile={profile}>
    <p className="eyebrow">PAINEL OPERACIONAL</p><h1>Olá, {firstName}</h1>
    <p className="page-description">Gerencie vencimentos, recebimentos e cobranças dos clientes.</p>
    <section className="card-grid secretary-cards" aria-label="Resumo operacional">
      <article className="metric-card"><h2>Parcelas com vencimento hoje</h2><strong className="metric-value">{summary.dueToday}</strong></article>
      <article className="metric-card"><h2>Parcelas a vencer neste mês</h2><strong className="metric-value">{summary.upcomingThisMonth}</strong></article>
      <article className="metric-card"><h2>Parcelas vencidas</h2><strong className="metric-value">{summary.overdue}</strong></article>
      <article className="metric-card"><h2>Recebimentos registrados neste mês</h2>
        <strong className="metric-value">{summary.paymentsThisMonth}</strong>
        <p>{formatBRL(summary.receivedCentsThisMonth / 100)} recebidos</p></article>
    </section>
    <SecretaryTable rows={rows} lawyers={lawyers} today={today} />
  </DashboardShell>;
}
