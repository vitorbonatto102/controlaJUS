import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { FinancialCard } from "@/components/financial-card";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import { summarizeContracts, todayInSaoPaulo } from "@/lib/contracts/view";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { loadNotifications } from "@/lib/finance/data";
import { followUpReasons } from "@/lib/contracts/follow-up";

export default async function LawyerPage() {
  const profile = await requireRole("lawyer");
  const [contracts, notifications] = await Promise.all([
    loadLawyerContracts(profile.id), loadNotifications(profile.id),
  ]);
  const today = todayInSaoPaulo();
  const summary = summarizeContracts(contracts, today);
  const firstName = profile.full_name.trim().split(/\s+/)[0];
  const upcoming = summary.rows.filter((row) => row.status === "upcoming").slice(0, 3);
  const followUpCount = contracts.filter((contract) => followUpReasons(contract).length > 0).length;
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return <DashboardShell profile={profile}>
    <div className="lawyer-welcome"><p className="eyebrow">PAINEL DA ADVOGADA</p>
      <h1>Olá, {firstName} 👋</h1>
      <p className="page-description">Acompanhe seus contratos. Seu financeiro completo está na Carteira.</p></div>
    <section className="card-grid" aria-label="Resumo dos meus contratos">
      <FinancialCard title="Total em contratos fechados" value={formatBRL(summary.totalContractedCents / 100)} hint="Principal conhecido; êxito a apurar fica em Acompanhamento" />
      <FinancialCard title="Meus contratos" value={String(contracts.length)} hint="Contratos vinculados à sua conta" />
      <FinancialCard title="Acompanhamento de ações" value={String(followUpCount)} hint="Êxito, honorários adicionais ou início condicionado" />
    </section>
    <section className="new-contract-banner"><div><p className="eyebrow">MEU FINANCEIRO</p>
      <h2>Uma visão completa da sua carteira</h2><p>Confira previsões mensais, recebimentos, comissões, inadimplência e repasses.</p></div>
      <Link className="primary-button" href="/advogada/carteira">Abrir minha carteira →</Link></section>
    <section className="new-contract-banner"><div><p className="eyebrow">CADASTRO</p>
      <h2>Um novo contrato começa aqui</h2><p>Registre o cliente, confira o cronograma e anexe o PDF.</p></div>
      <Link className="primary-button" href="/advogada/novo-contrato">+ Novo cliente / contrato</Link></section>
    {upcoming.length > 0 && <section className="upcoming-panel"><h2>Próximos vencimentos</h2>
      <div className="upcoming-list">{upcoming.map((row) => <Link key={row.installmentId}
        href={`/advogada/contratos/${row.contractId}`}><span>{row.clientName} · {row.installmentLabel}</span>
        <strong>{formatDateBR(row.dueDate)} · {formatBRL(row.contractualCents / 100)}</strong></Link>)}</div>
    </section>}
    <section className="new-contract-banner"><div><h2>Suas notificações</h2>
      <p>{unreadCount > 0 ? `${unreadCount} notificações ainda não lidas.` : "Você está em dia com as notificações."}</p></div>
      <Link href="/advogada/notificacoes" className="row-link">Ver notificações →</Link></section>
    <section className="new-contract-banner"><div><h2>Acompanhamento de ações</h2>
      <p>{followUpCount} contratos com êxito, honorários adicionais ou início condicionado.</p></div>
      <Link className="secondary-button" href="/acompanhamento">Ver acompanhamento →</Link></section>
  </DashboardShell>;
}
