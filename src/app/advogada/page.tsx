import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { FinancialCard } from "@/components/financial-card";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import { summarizeContracts, todayInSaoPaulo } from "@/lib/contracts/view";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { loadNotifications } from "@/lib/finance/data";
import { followUpReasons } from "@/lib/contracts/follow-up";
import styles from "@/components/contracts/contract-management.module.css";

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
      <p className="page-description">Uma visão geral dos seus contratos e honorários. Previsões e recebimentos por mês estão na Carteira.</p></div>
    <section className="card-grid" aria-label="Resumo dos meus contratos">
      <FinancialCard title="Total contratado · todos os períodos" value={formatBRL(summary.totalContractedCents / 100)}
        hint="Valores conhecidos de todos os seus contratos, inclusive quitados. Valores a apurar ficam em Acompanhamento." />
      <FinancialCard title="Meus contratos ativos" value={String(summary.activeContractCount)}
        hint="Contratos com parcelas definidas e saldo a receber, inclusive parciais e em atraso." />
      <FinancialCard title="Acompanhamento de ações futuras" value={String(followUpCount)}
        hint="Apenas no êxito, honorários adicionais ou início condicionado: valores que precisam ser monitorados." />
    </section>
    <section className="new-contract-banner"><div><p className="eyebrow">MEU FINANCEIRO</p>
      <h2>Uma visão completa da sua carteira</h2><p>Confira previsões mensais, recebimentos, comissões, inadimplência e repasses.</p></div>
      <Link className="primary-button" href="/advogada/carteira">Abrir minha carteira →</Link></section>
    <section className="new-contract-banner"><div><p className="eyebrow">CADASTRO</p>
      <h2>Meus contratos</h2><p>Visualize documentos, edite informações ou exclua contratos sem pagamentos.</p></div>
      <div className={styles.bannerButtons}><Link className="secondary-button" href="/advogada/contratos">Gerenciar contratos →</Link>
        <Link className="primary-button" href="/advogada/novo-contrato">+ Novo contrato</Link></div></section>
    {upcoming.length > 0 && <section className="upcoming-panel"><h2>Próximos vencimentos</h2>
      <div className="upcoming-list">{upcoming.map((row) => <Link key={row.installmentId}
        href={`/advogada/contratos/${row.contractId}`}><span>{row.clientName} · {row.installmentLabel}</span>
        <strong>{formatDateBR(row.dueDate)} · {formatBRL(row.contractualCents / 100)}</strong></Link>)}</div>
    </section>}
    <section className="new-contract-banner"><div><h2>Suas notificações</h2>
      <p>{unreadCount > 0 ? `${unreadCount} notificações ainda não lidas.` : "Você está em dia com as notificações."}</p></div>
      <Link href="/advogada/notificacoes" className="row-link">Ver notificações →</Link></section>
    <section className="new-contract-banner"><div><h2>Fechamentos e repasses</h2>
      <p>Consulte a apuração do mês, os fechamentos confirmados pelo gestor e os pagamentos feitos a você.</p></div>
      <Link href="/advogada/fechamentos" className="row-link">Ver meus fechamentos →</Link></section>
    <section className="new-contract-banner"><div><h2>Acompanhamento de ações futuras</h2>
      <p>Monitore {followUpCount} contratos com êxito, honorários adicionais ou início condicionado, para acompanhar os valores que poderão ser cobrados no futuro.</p></div>
      <Link className="secondary-button" href="/acompanhamento">Ver acompanhamento →</Link></section>
  </DashboardShell>;
}
