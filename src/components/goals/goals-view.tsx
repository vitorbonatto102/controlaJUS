import Link from "next/link";
import { monthLabel, shiftMonth } from "@/lib/contracts/wallet";
import { formatDateBR } from "@/lib/formatters";
import { goalEvolution, type GoalScope, type GoalSummary } from "@/lib/goals/model";
import { OverviewIcon } from "@/components/overview/overview-icon";
import { GoalEditor } from "./goal-editor";
import { MilestoneProgress } from "./milestone-progress";
import { GoalsHistory } from "./history-chart";
import styles from "./goals.module.css";

const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const contracts = (value: number) => `${value} ${value === 1 ? "contrato" : "contratos"}`;
export const goalsHref = (month: string, scope: GoalScope) => `/metas?mes=${month}&escopo=${scope}`;

export function GoalsView({ summary, today, canEdit, canViewIndividual, canViewOffice, identity }: {
  summary: GoalSummary; today: string; canEdit: boolean; canViewIndividual: boolean; canViewOffice: boolean;
  identity: string;
}) {
  const view = goalEvolution(summary, today);
  const next = shiftMonth(summary.month, 1), previous = shiftMonth(summary.month, -1);
  return <div className={styles.goals}>
    <header className={styles.heading}><div><h1>Suas metas</h1>
      <p>Um objetivo claro para acompanhar suas contratações, reconhecer o progresso e planejar o próximo passo.</p></div>
      {canViewIndividual && <Link className={styles.backLink} href="/advogada">Voltar ao painel <OverviewIcon name="arrow" size={16} /></Link>}</header>

    <div className={styles.controls}><nav className={styles.scopes} aria-label="Escopo da meta">
      {canViewIndividual && <Link href={goalsHref(summary.month, "individual")} aria-current={summary.scope === "individual" ? "page" : undefined}>Minha meta</Link>}
      {canViewOffice && <Link href={goalsHref(summary.month, "office")} aria-current={summary.scope === "office" ? "page" : undefined}>Meta do escritório</Link>}
    </nav><nav className={styles.period} aria-label="Mês da meta">
      {previous >= "2000-01" && <Link href={goalsHref(previous, summary.scope)} aria-label="Mês anterior">←</Link>}
      <strong>{monthLabel(summary.month)}</strong>
      {next <= today.slice(0, 7) ? <Link href={goalsHref(next, summary.scope)} aria-label="Próximo mês">→</Link> : <span aria-disabled="true">→</span>}
      {!view.current && <Link className={styles.currentMonth} href={goalsHref(today.slice(0, 7), summary.scope)}>Mês atual</Link>}
    </nav></div>

    <div className={styles.mainGrid}><section className={styles.mainGoal} aria-labelledby="main-goal-title">
      <div className={styles.goalHeader}><h2 id="main-goal-title">{summary.scope === "office" ? "Contratos fechados pelo escritório" : "Sua meta de contratos fechados"}</h2>
        <span>{view.current ? "Mês em andamento" : "Período encerrado"}</span></div>
      {view.target !== null ? <>
        <div className={styles.score}><strong>{summary.count}<span> / {view.target}</span></strong><p>{view.percentage}% do objetivo</p></div>
        <p className={styles.contextMessage} aria-live="polite">{view.reached ? "Meta do mês concluída." : !view.current ?
          `${contracts(summary.count)} com contratação registrada no período. Cada mês ajuda a planejar o próximo.` :
          `${view.remaining === 1 ? "Falta" : "Faltam"} ${contracts(view.remaining ?? 0)} para sua meta.`}</p>
        <MilestoneProgress count={summary.count} target={view.target} storageKey={`${identity}:${summary.scope}:${summary.month}`} />
      </> : <div className={styles.noGoal}><OverviewIcon name="target" size={31} /><h3>Qual é o seu próximo objetivo?</h3>
        <p>{contracts(summary.count)} com contratação registrada neste período.
          {canEdit ? " Defina quantos deseja fechar para acompanhar seu progresso." : " A administração pode definir a meta coletiva deste mês."}</p></div>}
      {canEdit ? <GoalEditor key={`${summary.month}:${summary.scope}:${summary.goal_updated_at}`} month={summary.month}
        scope={summary.scope} target={view.target} /> : <p className={styles.footnote}>A configuração da meta coletiva é feita por administradores do escritório.</p>}
      <p className={styles.footnote}>Contratações no documento até {formatDateBR(summary.as_of)}. Cada contrato conta uma vez.</p>
    </section>

    <aside className={styles.pace} aria-labelledby="pace-title"><span className={styles.paceIcon}><OverviewIcon name="calendar" size={25} /></span>
      <h2 id="pace-title">Seu ritmo no período</h2>
      {!view.current ? <><strong>Mês concluído</strong><p>O histórico deste período é uma referência para planejar os próximos objetivos.</p></> :
        view.reached ? <><strong>Objetivo alcançado</strong><p>{contracts(summary.count)} com contratação registrada. Os próximos fechamentos continuam compondo sua evolução.</p></> :
        view.target === null ? <><strong>Um passo de cada vez</strong><p>Defina a meta do mês para acompanhar o ritmo necessário até o fim do período.</p></> :
        view.daysRemaining === 0 ? <><strong>O mês termina hoje</strong><p>As contratações com data de hoje no documento ainda entram neste mês.</p></> :
        <><strong>{contracts(view.remaining ?? 0)} em {view.daysRemaining} {view.daysRemaining === 1 ? "dia" : "dias"}</strong>
          <p>Para chegar à meta nos dias restantes após hoje.</p><dl><dt>Ritmo necessário, em média</dt>
            <dd>{decimal(view.requiredPerDay ?? 0)} contratos por dia</dd></dl></>}
      {view.current && view.projection !== null && <div className={styles.projection}><span>Projeção ao ritmo atual</span>
        <strong>{contracts(view.projection)} no mês</strong><small>Estimativa pelo ritmo dos dias decorridos; depende de novos fechamentos.</small></div>}
      {view.newRecord && <p className={styles.record}><OverviewIcon name="event" size={18} />Uma nova melhor marca mensal no seu histórico de contratações.</p>}
    </aside></div>

    <section className={styles.metrics} aria-label="Evolução comercial">
      <article><h2>Fechados neste período</h2><strong>{summary.count}</strong><p>Contratos cadastrados pela data de contratação do documento.</p></article>
      <article><h2>Comparação com o mês anterior</h2><strong>{view.difference === null ? "—" : `${view.difference > 0 ? "+" : ""}${view.difference}`}</strong>
        <p>{view.difference === null ? "O comparativo aparece quando houver histórico de contratações anterior." :
          `${contracts(summary.previous_count)} no período anterior, até ${formatDateBR(summary.previous_until)}.`}</p></article>
      <article><h2>Média dos últimos três meses</h2><strong>{view.average === null ? "—" : decimal(view.average)}</strong>
        <p>{view.average === null ? "Histórico em formação: são necessários três meses anteriores com histórico registrado." : "Contratos por mês, nos três meses completos anteriores."}</p></article>
      <article><h2>Melhor marca anterior</h2><strong>{summary.best_previous_count ?? "—"}</strong>
        <p>{summary.best_previous_count === null ? "Suas primeiras contratações começam a construir essa referência." : "Maior quantidade em um mês anterior, no histórico de contratações."}</p></article>
    </section>
    <GoalsHistory months={summary.history} />

    <p className={styles.attribution}>{summary.scope === "individual" ?
      "A meta individual atribui cada contrato à advogada responsável principal. Contratantes adicionais não geram contagens extras." :
      "A meta coletiva considera os contratos do escritório uma única vez, independentemente da quantidade de contratantes."}
      {" "}Cancelamentos, exclusões e alterações na data de contratação atualizam o histórico. A situação do processo judicial não é usada nesta contagem.</p>
  </div>;
}
