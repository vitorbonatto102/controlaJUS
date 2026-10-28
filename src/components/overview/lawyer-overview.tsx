import Link from "next/link";
import type { ReactNode } from "react";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { monthLabel } from "@/lib/contracts/wallet";
import { followUpLabels } from "@/lib/contracts/follow-up";
import { contractGoalProgress, type MonthlyContractGoal } from "@/lib/dashboard/goals";
import type { LawyerOverview as OverviewData } from "@/lib/dashboard/lawyer-overview";
import { ContractGoal } from "./contract-goal";
import { OverviewDistribution, OverviewTrend } from "./overview-charts";
import { OverviewIcon } from "./overview-icon";
import styles from "./overview.module.css";

const money = (cents: number) => formatBRL(cents / 100);
const contractCount = (count: number) => `${count} ${count === 1 ? "contrato" : "contratos"}`;

function Metric({ title, value, icon, tone = "green", children, hint }: {
  title: string; value: string; icon: string; tone?: "green" | "amber" | "blue"; children: ReactNode; hint: string;
}) {
  return <article className={styles.metric}>
    <div className={`${styles.metricIcon} ${styles[tone]}`}><OverviewIcon name={icon} size={23} /></div>
    <div className={styles.metricBody}><h2>{title}</h2><strong>{value}</strong><p>{children}</p><small>{hint}</small></div>
  </article>;
}

function SectionHeading({ title, href, label = "Ver todos" }: { title: string; href: string; label?: string }) {
  return <div className={styles.panelHeading}><h2>{title}</h2>
    <Link href={href}>{label} <OverviewIcon name="arrow" size={15} /></Link></div>;
}

export function LawyerOverview({ data, fullName, goal, goalsAvailable }: {
  data: OverviewData; fullName: string; goal: MonthlyContractGoal | null; goalsAvailable: boolean;
}) {
  const firstName = fullName.trim().split(/\s+/)[0];
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" })
    .format(new Date(`${data.today}T12:00:00Z`));
  const { wallet } = data;
  const progress = contractGoalProgress(wallet.currentContractCount, goal?.target_contract_count ?? null);
  const priorities = [
    ...(data.dueTodayCount ? [{ icon: "calendar", title: `${data.dueTodayCount} ${data.dueTodayCount === 1 ? "parcela vence" : "parcelas vencem"} hoje`,
      description: "Acompanhe os recebimentos com a secretaria.", href: "/advogada/carteira" }] : []),
    ...(data.overdueContracts.length ? [{ icon: "clock", title: "Alinhar os recebimentos em atraso",
      description: `${contractCount(data.overdueContracts.length)} com saldo vencido.`, href: "#contratos-em-atencao" }] : []),
    ...(data.confirmedPendingCents ? [{ icon: "card", title: "Acompanhar meus repasses",
      description: `${money(data.confirmedPendingCents)} a receber em fechamentos confirmados.`, href: "/advogada/fechamentos" }] : []),
    ...(data.unreadCount ? [{ icon: "bell", title: "Conferir as atualizações da minha carteira",
      description: `${data.unreadCount} ${data.unreadCount === 1 ? "notificação não lida" : "notificações não lidas"}.`, href: "/advogada/notificacoes" }] : []),
    ...(data.futureEvents.length ? [{ icon: "event", title: "Revisar contratos aguardando evento",
      description: `${contractCount(data.futureEvents.length)} com possíveis honorários futuros.`, href: "/acompanhamento" }] : []),
  ];
  const overdueAttention = data.overdueContracts.slice(0, 3);
  const futureAttention = data.futureEvents.filter((event) => !overdueAttention.some((entry) => entry.contractId === event.id))
    .slice(0, 4 - overdueAttention.length);

  return <div className={styles.overview}>
    <div className={styles.dateLine}><span>{weekday}, {formatDateBR(data.today)}</span>
      <Link href="/advogada/novo-contrato" className={styles.newContract}>+ Novo contrato</Link></div>
    <div className={styles.hero}><header className={styles.welcome}>
      <p className={styles.eyebrow}>SEU PAINEL FINANCEIRO · {monthLabel(data.month)}</p>
      <h1>Olá, {firstName} <span className={styles.wave} aria-hidden="true">👋</span></h1>
      <p>Aqui está um resumo do seu financeiro e dos seus próximos passos.</p>
      <span className={styles.dailySummary}><span aria-hidden="true" />{data.dueTodayCount
        ? `${data.dueTodayCount} ${data.dueTodayCount === 1 ? "parcela com vencimento" : "parcelas com vencimento"} hoje. Confira suas prioridades.`
        : data.overdueContracts.length ? `${contractCount(data.overdueContracts.length)} com saldo em atraso ${data.overdueContracts.length === 1 ? "merece" : "merecem"} sua atenção.`
          : "Sua carteira está sem parcelas em atraso. Acompanhe os próximos recebimentos."}</span>
    </header><ContractGoal key={goal?.updated_at ?? String(goalsAvailable)} goal={goal} available={goalsAvailable}
      achieved={wallet.currentContractCount} month={data.month} /></div>

    <section className={styles.metrics} aria-label={`Seu financeiro em ${monthLabel(data.month)}`}>
      <Metric title="Minha comissão prevista no mês" value={money(wallet.current.estimatedCents)} icon="down"
        hint="Expectativa se as parcelas do mês forem pagas.">
        Sobre {money(wallet.current.contractualCents)} em parcelas</Metric>
      <Metric title="Minha comissão gerada no mês" value={money(wallet.current.generatedCents)} icon="card"
        hint="Já gerada nos pagamentos; pode aguardar repasse.">
        {data.commissionChange === null ? "Nenhuma comissão no período anterior." :
          <><span className={data.commissionChange >= 0 ? styles.positive : styles.negative}>
            {data.commissionChange > 0 ? "+" : ""}{data.commissionChange}%</span> vs. mesmo período anterior</>}</Metric>
      <Metric title="Minha participação em atraso" value={money(wallet.overdueParticipationCents)} icon="clock" tone="amber"
        hint="Estimativa sobre saldos vencidos; ainda não gerada.">
        {wallet.overdueCount} {wallet.overdueCount === 1 ? "parcela" : "parcelas"} · {contractCount(data.overdueContracts.length)}</Metric>
      <Metric title="Meus contratos ativos" value={String(data.activeContractCount)} icon="contract" tone="blue"
        hint="Contratos com parcelas e saldo a receber.">
        <span className={styles.positive}>{wallet.currentContractCount}</span> {wallet.currentContractCount === 1 ? "contrato fechado" : "contratos fechados"} neste mês</Metric>
    </section>

    <div className={styles.settlementLine} aria-label="Situação dos recebimentos e repasses">
      <span>Recebido dos meus clientes no mês <strong>{money(wallet.current.receivedCents)}</strong></span>
      <Link href="/advogada/fechamentos">A receber em fechamentos confirmados <strong>{money(data.confirmedPendingCents)}</strong><OverviewIcon name="arrow" size={15} /></Link>
      <span>Repassado para mim neste mês <strong>{money(data.transferredThisMonthCents)}</strong></span>
    </div>

    <div className={styles.charts}>
      <OverviewTrend timeline={data.timeline} />
      <OverviewDistribution origins={data.origins} total={wallet.current.generatedCents} />
      <aside className={styles.insight} aria-labelledby="insight-title"><span className={styles.insightIcon}>
        <OverviewIcon name={progress.reached ? "check" : "target"} size={29} /></span>
        <p className={styles.eyebrow}>CONTRATOS · MÊS ATUAL</p>
        <h2 id="insight-title">{progress.reached ? "Você chegou lá." : goal ? "Cada contrato conta." : "Um objetivo, um próximo passo."}</h2>
        <p>{goal ? <><strong>{wallet.currentContractCount} de {goal.target_contract_count} contratos</strong> fechados.
          {progress.reached ? " Meta alcançada." : ` ${progress.percentage}% da sua meta.`}</> :
          "Defina quantos contratos deseja fechar e acompanhe seu progresso ao longo do mês."}</p>
        <small>{contractCount(data.previousContractCount)} no mês anterior, até {formatDateBR(data.previousDate)}.</small>
        <Link href="/metas">{goal ? "Acompanhar minha meta" : "Definir minha meta"}<OverviewIcon name="arrow" size={16} /></Link>
      </aside>
    </div>

    <div className={styles.operations}>
      <section className={styles.panel} aria-label="Próximos recebimentos">
        <SectionHeading title="Próximos recebimentos" href="/advogada/carteira" />
        {data.upcoming.length ? <ul className={styles.receiptList}>{data.upcoming.map((row) => <li key={row.installmentId}>
          <Link href={`/advogada/contratos/${row.contractId}`}><span className={styles.avatar} aria-hidden="true">
            {row.clientName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
            <span className={styles.receiptClient}><strong>{row.clientName}</strong>
              <small>{row.installmentLabel} · {row.service || "Serviço não informado"}</small>
              <span className={`${styles.receiptStatus} ${row.dueDate === data.today ? styles.dueToday : ""}`}>
                {row.dueDate === data.today ? "Vence hoje" : "A vencer"} · {formatDateBR(row.dueDate)}</span></span>
            <span className={styles.receiptAmount}><strong>{money(Math.max(0, row.contractualCents - (row.paidCents ?? 0)))}</strong>
              <small>Minha previsão</small><b>{money(row.remainingEstimatedCents ?? 0)}</b></span>
          </Link></li>)}</ul> : <div className={styles.listEmpty}><OverviewIcon name="calendar" size={28} />
          <p>Nenhuma próxima parcela em aberto.</p><small>Novos vencimentos aparecerão aqui.</small></div>}
        <p className={styles.panelFootnote}>Uma próxima parcela por contrato. A previsão depende do pagamento do cliente.</p>
      </section>

      <section className={styles.panel} aria-label="Suas prioridades">
        <div className={styles.panelHeading}><h2>Suas prioridades <span className={styles.count}>{priorities.length}</span></h2>
          <span className={styles.smallLabel}>Com base na sua carteira</span></div>
        {priorities.length ? <ul className={styles.priorityList}>{priorities.map((item) => <li key={item.title}>
          <Link href={item.href}><span className={styles.priorityIcon}><OverviewIcon name={item.icon} size={17} /></span>
            <span><strong>{item.title}</strong><small>{item.description}</small></span><OverviewIcon name="arrow" size={16} /></Link>
        </li>)}</ul> : <div className={styles.listEmpty}><OverviewIcon name="check" size={29} />
          <p>Tudo em dia por aqui.</p><small>Nenhuma pendência identificada nos registros atuais.</small></div>}
        {data.futureEvents.length > 0 && <Link className={styles.eventLink} href="/acompanhamento">
          <OverviewIcon name="event" size={17} />{contractCount(data.futureEvents.length)} aguardando evento<OverviewIcon name="arrow" size={16} /></Link>}
      </section>

      <section className={styles.panel} id="contratos-em-atencao" aria-label="Contratos em atenção">
        <SectionHeading title="Contratos em atenção" href={data.overdueContracts.length ? "/advogada/carteira" : "/acompanhamento"} />
        <ul className={styles.attentionList}>{overdueAttention.map((entry) => <li key={entry.contractId}>
          <Link href={`/advogada/contratos/${entry.contractId}`}><span className={`${styles.priorityIcon} ${styles.amber}`}><OverviewIcon name="clock" size={18} /></span>
            <span><strong>{entry.clientName}</strong><small className={styles.negative}>{entry.count} {entry.count === 1 ? "parcela em atraso" : "parcelas em atraso"}</small>
              <small>Minha participação estimada: {money(entry.participationCents)}</small></span></Link>
        </li>)}{futureAttention.map((event) => <li key={event.id}>
          <Link href={`/advogada/contratos/${event.id}`}><span className={styles.priorityIcon}><OverviewIcon name="event" size={18} /></span>
            <span><strong>{event.clientName}</strong><small>Aguardando evento · {event.reasons.map((reason) => followUpLabels[reason]).join(" / ")}</small></span></Link>
        </li>)}</ul>
        {overdueAttention.length === 0 && futureAttention.length === 0 && <div className={styles.listEmpty}>
          <OverviewIcon name="check" size={29} /><p>Nenhum contrato em atenção.</p><small>Alertas e eventos futuros aparecerão aqui.</small></div>}
        <p className={styles.panelFootnote}>Revise os atrasos com a secretaria e monitore os eventos que podem gerar honorários.</p>
      </section>
    </div>
    {wallet.missingCommissionCount > 0 && <p className={styles.dataNotice} role="status">
      Há {wallet.missingCommissionCount} {wallet.missingCommissionCount === 1 ? "recebimento com comissão indisponível" : "recebimentos com comissão indisponível"}. Os valores gerados podem estar incompletos; procure o gestor.</p>}
    <footer className={styles.footer}><span>Posição em {formatDateBR(data.today)} · Somente dados vinculados à sua conta</span>
      <Link href="/advogada/contratos">Total contratado · todos os períodos: {money(wallet.totalContractedCents)}<OverviewIcon name="arrow" size={14} /></Link></footer>
  </div>;
}
