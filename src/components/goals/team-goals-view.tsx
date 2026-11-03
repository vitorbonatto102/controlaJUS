import Link from "next/link";
import { monthLabel, shiftMonth } from "@/lib/contracts/wallet";
import { formatDateBR } from "@/lib/formatters";
import { contractGoalProgress } from "@/lib/dashboard/goals";
import type { TeamGoalSummary } from "@/lib/goals/model";
import styles from "./goals.module.css";

export function TeamGoalsView({ summary, today, lawyerId = "" }: { summary: TeamGoalSummary; today: string; lawyerId?: string }) {
  const members = summary.members.filter(m => !lawyerId || m.lawyer_id === lawyerId);
  const total = members.reduce((sum, m) => sum + m.count, 0);
  const configured = members.filter(m => m.target !== null);
  const reached = configured.filter(m => m.count >= m.target!).length;
  const previous = shiftMonth(summary.month, -1), next = shiftMonth(summary.month, 1);
  const href = (month: string) => `/gestor/metas?${new URLSearchParams({ mes: month, advogada: lawyerId })}`;
  return <div className={styles.goals}>
    <header className={styles.heading}><div><h1>Metas da equipe</h1>
      <p>Acompanhe os contratos fechados e o progresso das metas definidas por cada advogada, no mês da contratação.</p></div>
      <Link className={styles.backLink} href="/gestor">Voltar ao painel →</Link></header>
    <section className={styles.chartPanel} aria-label="Filtros das metas da equipe">
      <form action="/gestor/metas" method="get" className={styles.teamFilters}>
        <label>Mês de referência<input name="mes" type="month" defaultValue={summary.month} min="2000-01" max={today.slice(0, 7)} required /></label>
        <label>Advogada<select name="advogada" defaultValue={lawyerId}><option value="">Toda a equipe</option>
          {summary.members.map(m => <option key={m.lawyer_id} value={m.lawyer_id}>{m.full_name}{!m.active ? " · inativa" : ""}</option>)}</select></label>
        <button className="primary-button">Aplicar filtros</button>
      </form>
      <nav className={styles.period} aria-label="Mês das metas da equipe">
        {previous >= "2000-01" && <Link href={href(previous)} aria-label="Mês anterior">←</Link>}
        <strong>{monthLabel(summary.month)}</strong>
        {next <= today.slice(0, 7) ? <Link href={href(next)} aria-label="Próximo mês">→</Link> : <span aria-disabled="true">→</span>}
        {summary.month !== today.slice(0, 7) && <Link className={styles.currentMonth} href={href(today.slice(0, 7))}>Mês atual</Link>}
      </nav>
    </section>
    <section className={styles.metrics} aria-label="Resumo das metas da equipe">
      <article><h2>Contratos fechados no período</h2><strong>{total}</strong><p>Pela data de contratação do documento, até {formatDateBR(summary.as_of)}.</p></article>
      <article><h2>Advogadas acompanhadas</h2><strong>{members.length}</strong><p>Responsáveis pelos contratos e metas do filtro.</p></article>
      <article><h2>Com meta definida</h2><strong>{configured.length}</strong><p>Objetivos individuais para o mês selecionado.</p></article>
      <article><h2>Metas alcançadas</h2><strong>{reached}</strong><p>Cada advogada define e acompanha seu próprio objetivo.</p></article>
    </section>
    <section className={styles.chartPanel}><h2>Acompanhamento individual</h2>
      <p className={styles.teamDescription}>Uma visão da equipe para apoiar o planejamento. As metas são configuradas pelas próprias advogadas.</p>
      {members.length ? <div className="table-scroll"><table className={styles.teamTable}>
        <thead><tr><th scope="col">Advogada</th><th scope="col">Fechados no mês</th><th scope="col">Meta</th><th scope="col">Progresso</th><th scope="col">Faltam</th><th scope="col">Mês anterior</th></tr></thead>
        <tbody>{members.map(m => { const progress = contractGoalProgress(m.count, m.target); return <tr key={m.lawyer_id}>
          <th scope="row">{m.full_name}{!m.active && <small>Conta inativa · histórico preservado</small>}</th>
          <td>{m.count}</td><td>{m.target ?? "Não definida"}</td><td>{m.target === null ? "—" : <>
            <span>{progress.percentage}%</span><progress aria-label={`Progresso de ${m.full_name}`} value={Math.min(m.count, m.target)} max={m.target} /></>}</td>
          <td>{m.target === null ? "—" : progress.reached ? "Alcançada" : progress.remaining}</td><td>{m.previous_count}</td>
        </tr>; })}</tbody>
      </table></div> : <p>Nenhuma advogada encontrada para este filtro.</p>}
      <p className={styles.footnote}>O mês anterior considera contratações até {formatDateBR(summary.previous_until)}. A contagem exclui cancelados e apagados. Cada contrato conta uma vez, para sua responsável principal.</p>
    </section>
  </div>;
}
