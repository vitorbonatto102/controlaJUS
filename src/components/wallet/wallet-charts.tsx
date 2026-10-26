import { formatBRL } from "@/lib/formatters";
import { monthLabel, monthNames, type WalletMonth } from "@/lib/contracts/wallet";
import styles from "./wallet.module.css";

const money = (cents: number) => formatBRL(cents / 100);
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function ParticipationChart({ months, referenceMonth }: { months: WalletMonth[]; referenceMonth: string }) {
  const maximum = Math.max(...months.flatMap((month) => [month.estimatedCents, month.generatedCents]), 0);
  const ceiling = Math.max(maximum * 1.1, 100);
  const chartHeight = 190;
  return <section className={styles.panel} aria-labelledby="participation-chart-title">
    <h2 id="participation-chart-title">Minha participação, mês a mês</h2>
    <p className={styles.subheading}>12 meses em torno do período selecionado. Passe sobre as barras para ver os valores.</p>
    <div className={styles.legend}><span><i className={`${styles.swatch} ${styles.estimateSwatch}`} />Prevista no contrato</span>
      <span><i className={styles.swatch} />Comissão efetiva</span></div>
    {maximum === 0 ? <div className={styles.empty}>Seu histórico financeiro começa aqui.
      <p>Parcelas e recebimentos aparecerão assim que forem registrados.</p></div> : <>
      <div className={styles.chartScroll}><svg className={styles.chart} viewBox="0 0 760 265"
        role="img" aria-label="Comparação mensal entre participação contratual prevista e comissão efetivamente gerada">
        {[0, 1, 2, 3, 4].map((index) => {
          const y = 15 + chartHeight * index / 4;
          return <g key={index}><line x1="64" x2="751" y1={y} y2={y} stroke="#e7eeea" strokeDasharray="3 5" />
            <text x="54" y={y + 4} textAnchor="end">{compact.format(ceiling * (1 - index / 4) / 100)}</text></g>;
        })}
        <text x="54" y="8" textAnchor="end">R$</text>
        {months.map((month, index) => {
          const x = 74 + index * 56;
          const estimatedHeight = month.estimatedCents / ceiling * chartHeight;
          const generatedHeight = month.generatedCents / ceiling * chartHeight;
          const label = `${monthLabel(month.month)}: prevista ${money(month.estimatedCents)}, efetiva ${money(month.generatedCents)}`;
          return <g key={month.month} tabIndex={0} className={styles.chartGroup} aria-label={label}>
            <title>{label}</title>
            {month.month === referenceMonth && <rect x={x - 7} y="10" width="50" height="204" rx="6" fill="#f2f7f3" />}
            <rect x={x} y={205 - estimatedHeight} width="15" height={estimatedHeight} rx="3" fill="#b3e8d5" />
            <rect x={x + 19} y={205 - generatedHeight} width="15" height={generatedHeight} rx="3" fill="#137e68" />
            <text x={x + 17} y="234" textAnchor="middle" className={month.month === referenceMonth ? styles.referenceLabel : undefined}>
              {monthNames[Number(month.month.slice(5)) - 1].slice(0, 3)}</text>
            <text x={x + 17} y="250" textAnchor="middle">{month.month.slice(0, 4)}</text>
          </g>;
        })}
      </svg></div>
      <details className={styles.chartData}><summary>Ver valores do gráfico</summary><div className="table-scroll">
        <table className={styles.table}><caption className={styles.srOnly}>Participação por mês</caption><thead><tr>
          <th scope="col">Mês</th><th scope="col">Prevista no contrato</th><th scope="col">Comissão efetiva</th>
        </tr></thead><tbody>{months.map((month) => <tr key={month.month}><td>{monthLabel(month.month)}</td>
          <td>{money(month.estimatedCents)}</td><td>{money(month.generatedCents)}</td></tr>)}</tbody></table></div></details>
    </>}
    <p className={styles.balanceNote} style={{ color: "var(--muted)" }}>Previsto pelo vencimento; efetivo pela data de cada pagamento, incluindo juros e multas recebidos.</p>
  </section>;
}

export function OriginChart({ origins, total }: { origins: { origin: string; cents: number }[]; total: number }) {
  return <section className={styles.panel} aria-labelledby="origin-chart-title"><h2 id="origin-chart-title">Participação por origem</h2>
    <p className={styles.subheading}>Sua participação contratada sobre os valores conhecidos de toda a carteira filtrada.</p>
    {total === 0 ? <div className={styles.empty}>Nenhuma participação contratada para exibir.</div> :
      <ul className={styles.origins}>{origins.map(({ origin, cents }, index) => {
        const percentage = cents / total * 100;
        return <li key={origin}><div className={styles.originLabels}><span>{origin}</span><strong>{money(cents)}</strong></div>
          <div className={styles.track} aria-hidden="true"><span style={{ width: `${percentage}%`, opacity: Math.max(.5, 1 - index * .15) }} /></div>
          <span className={styles.originPercent}>{percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da participação contratada</span></li>;
      })}</ul>}
  </section>;
}

export function MonthlyOutlook({ months }: { months: WalletMonth[] }) {
  const total = months.reduce((sum, month) => sum + month.remainingParticipationCents, 0);
  return <section className={styles.panel} aria-labelledby="outlook-title"><div className={styles.outlookHeader}><div>
    <h2 id="outlook-title">Quanto está previsto para os próximos meses?</h2>
    <p className={styles.subheading}>Saldo ainda não pago das parcelas, conforme o percentual, a forma de retenção e o limite da comissão de cada contrato.</p>
  </div><span className={styles.badge}>Previsão · 6 meses</span></div>
    <div className="table-scroll"><table className={styles.table}><thead><tr><th scope="col">Mês de vencimento</th>
      <th scope="col">Previsto dos clientes</th><th scope="col">Ainda não recebido</th><th scope="col">Minha participação a gerar</th>
    </tr></thead><tbody>{months.map((month) => <tr key={month.month}><td>{monthLabel(month.month)}</td>
      <td>{money(month.contractualCents)}</td><td>{money(month.remainingCents)}</td>
      <td className={styles.outlookValue}>{money(month.remainingParticipationCents)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={3}>Minha previsão total</td><td className={styles.outlookValue}>{money(total)}</td></tr></tfoot>
    </table></div>
    <p className={styles.subheading} style={{ margin: "18px 0 0" }}>Estimativas dependem do pagamento do cliente. O mês de vencimento não determina a data do repasse à advogada.</p>
  </section>;
}
