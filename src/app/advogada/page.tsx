import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { FinancialCard } from "@/components/financial-card";
import { LawyerTable } from "@/components/lawyer-table";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import { summarizeContracts, todayInSaoPaulo } from "@/lib/contracts/view";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { loadClosings, loadClosingDetails, loadNotifications } from "@/lib/finance/data";
import { numericToCents } from "@/lib/contracts/finance";

export default async function LawyerPage() {
  const profile = await requireRole("lawyer");
  const [contracts, closings, details, notifications] = await Promise.all([
    loadLawyerContracts(profile.id), loadClosings(profile.id), loadClosingDetails(), loadNotifications(profile.id),
  ]);
  const today = todayInSaoPaulo();
  const summary = summarizeContracts(contracts, today);
  const firstName = profile.full_name.trim().split(/\s+/)[0];
  const upcoming = summary.rows.filter((row) => row.status === "upcoming").slice(0, 3);
  const generatedCents = contracts.reduce((sum, contract) => sum + contract.installments.reduce(
    (itemSum, installment) => itemSum + installment.payments.filter((payment) => !payment.voided_at)
      .reduce((paymentSum, payment) => paymentSum +
        numericToCents(payment.commissions?.commission_amount ?? 0), 0), 0), 0);
  const transferredCents = details.transfers.filter((item) => !item.reversed_at)
    .reduce((sum, item) => sum + numericToCents(item.amount), 0);
  const outstandingCents = generatedCents - transferredCents;
  const delinquencyByClient = new Map<string, { name: string; firstDue: string; count: number;
    balanceCents: number; potentialCents: number }>();
  for (const row of summary.rows.filter((item) => item.dueDate < today &&
    item.contractualCents > (item.paidCents ?? 0))) {
    const current = delinquencyByClient.get(row.clientId) ?? {
      name: row.clientName, firstDue: row.dueDate, count: 0, balanceCents: 0, potentialCents: 0,
    };
    const balance = row.contractualCents - (row.paidCents ?? 0);
    current.firstDue = current.firstDue < row.dueDate ? current.firstDue : row.dueDate;
    current.count += 1;
    current.balanceCents += balance;
    current.potentialCents += Math.round(balance * row.percentage / 100);
    delinquencyByClient.set(row.clientId, current);
  }
  const delinquency = [...delinquencyByClient.entries()];
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return <DashboardShell profile={profile}>
    <div className="lawyer-welcome"><p className="eyebrow">PAINEL DA ADVOGADA</p>
      <h1>Olá, {firstName} 👋</h1>
      <p className="page-description">Veja um resumo dos seus contratos e da sua previsão financeira.</p></div>
    <section className="card-grid lawyer-cards" aria-label="Resumo financeiro">
      <FinancialCard title="Total em contratos fechados" value={formatBRL(summary.totalContractedCents / 100)} hint="Valor total contratado" />
      <FinancialCard title="Minha participação contratada" value={formatBRL(summary.contractedParticipationCents / 100)} hint="Previsão contratual, ainda não recebida" />
      <FinancialCard title="Estimativa deste mês" value={formatBRL(summary.monthlyEstimateCents / 100)} hint="Sobre parcelas com vencimento neste mês" />
      <FinancialCard title="Participação efetivamente gerada neste mês" value={formatBRL(summary.monthlyGeneratedCents / 100)} hint={summary.monthlyGeneratedCents ? "Sobre valores efetivamente pagos" : "Aguardando lançamentos de recebimentos"} />
      <FinancialCard title="A receber" value={formatBRL(outstandingCents / 100)} hint="Saldo total: comissões geradas menos repasses registrados" />
    </section>
    <section className="new-contract-banner"><div><p className="eyebrow">CADASTRO</p>
      <h2>Um novo contrato começa aqui</h2><p>Registre o cliente, confira o cronograma e anexe o PDF.</p></div>
      <Link className="primary-button" href="/advogada/novo-contrato">+ Novo cliente / contrato</Link></section>
    {upcoming.length > 0 && <section className="upcoming-panel"><h2>Próximos vencimentos</h2>
      <div className="upcoming-list">{upcoming.map((row) => <Link key={row.installmentId}
        href={`/advogada/contratos/${row.contractId}`}><span>{row.clientName} · {row.installmentLabel}</span>
        <strong>{formatDateBR(row.dueDate)} · {formatBRL(row.contractualCents / 100)}</strong></Link>)}</div>
    </section>}
    <section className="workspace-panel lawyer-section"><div className="section-title-row"><h2>Meus fechamentos</h2>
      <Link href="/advogada/notificacoes" className="row-link">🔔 Notificações {unreadCount > 0 && `(${unreadCount})`}</Link></div>
      {closings.length ? <div className="table-scroll"><table className="data-table"><thead><tr>
        <th>Mês</th><th>Comissão gerada</th><th>Repassado</th><th>Saldo</th><th>Status</th>
      </tr></thead><tbody>{closings.map((closing) => <tr key={closing.id}>
        <td>{String(closing.reference_month).padStart(2, "0")}/{closing.reference_year}</td>
        <td>{formatBRL(closing.commission_amount + closing.adjustment_amount)}
          {closing.adjustment_amount !== 0 && <small> · Corrigido após fechamento</small>}</td>
        <td>{formatBRL(closing.amount_already_transferred)}</td>
        <td>{formatBRL(closing.amount_pending_transfer)}</td>
        <td>{{ draft: "Em apuração", closed: "Fechado", partial: "Parcialmente pago", paid: "Pago" }[closing.status]}
          {closing.amount_overpaid > 0 && <small> · Excesso a regularizar: {formatBRL(closing.amount_overpaid)}</small>}</td>
      </tr>)}</tbody></table></div> : <p>Nenhum fechamento realizado.</p>}
    </section>
    <section className="workspace-panel lawyer-section"><h2>Inadimplência dos meus contratos</h2>
      <p>Participação potencial é uma estimativa contratual; ainda não é comissão gerada.</p>
      {delinquency.length ? <div className="table-scroll"><table className="data-table"><thead><tr>
        <th>Cliente</th><th>Inadimplente desde</th><th>Parcelas pendentes</th><th>Saldo contratual</th><th>Participação potencial</th>
      </tr></thead><tbody>{delinquency.map(([clientId, row]) =>
        <tr key={clientId}><td>{row.name}</td><td>{formatDateBR(row.firstDue)}</td>
          <td>{row.count}</td><td>{formatBRL(row.balanceCents / 100)}</td>
          <td>{formatBRL(row.potentialCents / 100)}</td></tr>)}</tbody></table></div> : <p>Nenhuma parcela inadimplente.</p>}
    </section>
    <LawyerTable rows={summary.rows} />
  </DashboardShell>;
}
