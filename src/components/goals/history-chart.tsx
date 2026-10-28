import type { GoalMonth } from "@/lib/goals/model";
import { monthLabel } from "@/lib/contracts/wallet";
import styles from "./goals.module.css";

export function GoalsHistory({ months }: { months: GoalMonth[] }) {
  const maximum = Math.max(4, ...months.flatMap((item) => [item.count, item.target ?? 0]));
  const ceiling = Math.ceil(maximum / 4) * 4;
  const x = (index: number) => 80 + index * 84;
  const y = (value: number) => 181 - value / ceiling * 152;
  const hasData = months.some((item) => item.has_history || item.target !== null);
  return <section className={styles.chartPanel} aria-labelledby="goals-history-title">
    <div className={styles.sectionHeading}><div><h2 id="goals-history-title">Sua evolução, mês a mês</h2>
      <p>Últimos seis meses do período selecionado.</p></div><div className={styles.legend}>
      <span><i />Contratos fechados</span><span><i className={styles.targetSwatch} />Meta definida</span></div></div>
    {!hasData ? <div className={styles.chartEmpty}><p>O seu histórico começa com uma contratação confirmada.</p>
      <small>As metas definidas também aparecerão aqui, no mês correspondente.</small></div> : <>
      <div className={styles.chartScroll} tabIndex={0} aria-label="Gráfico de contratos fechados e metas nos últimos seis meses">
        <svg viewBox="0 0 560 240" className={styles.chart} role="img" aria-label="Quantidades de contratos fechados e metas mensais">
          {[0, 1, 2, 3, 4].map((step) => <g key={step}><line x1="44" x2="545" y1={y(ceiling * step / 4)} y2={y(ceiling * step / 4)} stroke="#e5ece7" />
            <text x="35" y={y(ceiling * step / 4) + 4} textAnchor="end">{ceiling * step / 4}</text></g>)}
          {months.map((item, index) => <g key={item.month} tabIndex={0}
            aria-label={`${monthLabel(item.month)}: ${item.has_history ? `${item.count} contratos confirmados` : "sem histórico de confirmações"}; ${item.target === null ? "sem meta" : `meta ${item.target}`}`}>
            <title>{`${monthLabel(item.month)} · ${item.has_history ? `${item.count} confirmados` : "Sem histórico de confirmações"} · ${item.target === null ? "Sem meta definida" : `Meta: ${item.target}`}`}</title>
            <rect x={x(index) - 17} y={y(item.count)} width="34" height={item.count / ceiling * 152} rx="4" fill="#347f68" />
            {!item.has_history && <text x={x(index)} y="176" textAnchor="middle">—</text>}
            {item.target !== null && <>
              {index > 0 && months[index - 1].target !== null && <line x1={x(index - 1)} y1={y(months[index - 1].target!)}
                x2={x(index)} y2={y(item.target)} stroke="#a49a7c" strokeWidth="1.8" strokeDasharray="4 5" />}
              <circle cx={x(index)} cy={y(item.target)} r="4" fill="#f9faf6" stroke="#a49a7c" strokeWidth="2" />
            </>}
            <text x={x(index)} y="208" textAnchor="middle">{monthLabel(item.month, true).split(" / ")[0]}</text>
            <text x={x(index)} y="226" textAnchor="middle">{item.month.slice(0, 4)}</text>
          </g>)}
        </svg>
      </div>
      <details className={styles.chartValues}><summary>Consultar valores do gráfico</summary><div className={styles.chartScroll}>
        <table><caption>Histórico de contratações confirmadas</caption><thead><tr><th>Mês</th><th>Fechados</th><th>Meta</th></tr></thead>
          <tbody>{months.map((item) => <tr key={item.month}><td>{monthLabel(item.month)}</td><td>{item.has_history ? item.count : "Sem histórico"}</td><td>{item.target ?? "Não definida"}</td></tr>)}</tbody></table>
      </div></details>
    </>}
    <p className={styles.footnote}>Somente confirmações explícitas, pela data efetiva. Traços indicam meses anteriores ao histórico confirmado. Uma meta ausente não é tratada como meta zero.</p>
  </section>;
}
