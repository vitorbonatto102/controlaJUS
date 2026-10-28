"use client";

import { useId, useState } from "react";
import { formatBRL } from "@/lib/formatters";
import { monthLabel, type WalletMonth } from "@/lib/contracts/wallet";
import styles from "./overview.module.css";

const money = (cents: number) => formatBRL(cents / 100);
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function OverviewTrend({ timeline }: { timeline: WalletMonth[] }) {
  const [period, setPeriod] = useState("6");
  const titleId = useId();
  const months = timeline.slice(-Number(period));
  const maximum = Math.max(0, ...months.flatMap((month) => [month.estimatedCents, month.generatedCents]));
  const ceiling = Math.max(maximum * 1.15, 100);
  return <section className={styles.panel} aria-labelledby={titleId}>
    <div className={styles.panelHeading}><h2 id={titleId}>Minha comissão, mês a mês</h2>
      <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Período do gráfico de comissões">
        <option value="6">Últimos 6 meses</option><option value="3">Últimos 3 meses</option></select></div>
    <div className={styles.legend}><span><i className={styles.generatedSwatch} />Gerada</span>
      <span><i className={styles.estimateSwatch} />Prevista</span></div>
    {maximum === 0 ? <div className={styles.chartEmpty}>Seu histórico começa com o primeiro contrato.
      <small>Previsões e comissões aparecerão aqui conforme os registros.</small></div> : <>
      <svg viewBox="0 0 560 225" className={styles.trendChart} role="img" aria-label="Comissões previstas e geradas por mês, em reais">
        {[0, 1, 2, 3].map((tick) => {
          const y = 18 + tick * 52;
          return <g key={tick}><line x1="52" x2="550" y1={y} y2={y} stroke="#e5ece6" />
            <text x="43" y={y + 4} textAnchor="end">{compact.format(ceiling * (1 - tick / 3) / 100)}</text></g>;
        })}
        {months.map((month, index) => {
          const width = 496 / months.length;
          const x = 52 + index * width + width / 2;
          const actual = month.generatedCents / ceiling * 156;
          const expected = month.estimatedCents / ceiling * 156;
          const label = `${monthLabel(month.month)}: gerada ${money(month.generatedCents)}; prevista ${money(month.estimatedCents)}`;
          return <g key={month.month} tabIndex={0} aria-label={label}><title>{label}</title>
            <rect x={x - 23} y={174 - actual} width="21" height={actual} rx="3" fill="#247964" />
            <rect x={x + 3} y={174 - expected} width="21" height={expected} rx="3" fill="#dfd4b7" />
            <text x={x} y="196" textAnchor="middle">{monthLabel(month.month, true).split(" / ")[0]}</text>
            <text x={x} y="213" textAnchor="middle" className={styles.chartYear}>{month.month.slice(0, 4)}</text>
          </g>;
        })}
      </svg>
      <details className={styles.chartData}><summary>Ver valores do gráfico</summary><div className="table-scroll">
        <table><thead><tr><th>Mês</th><th>Gerada</th><th>Prevista</th></tr></thead><tbody>
          {months.map((month) => <tr key={month.month}><td>{monthLabel(month.month)}</td>
            <td>{money(month.generatedCents)}</td><td>{money(month.estimatedCents)}</td></tr>)}
        </tbody></table></div></details>
    </>}
    <p className={styles.panelFootnote}>Prevista pelo vencimento. Gerada pelos pagamentos recebidos. Mês atual parcial.</p>
  </section>;
}

const originColors = ["#123439", "#388571", "#a6bca9"];

export function OverviewDistribution({ origins, total }: { origins: { origin: string; cents: number }[]; total: number }) {
  const titleId = useId();
  let position = 0;
  const segments = origins.map((origin, index) => {
    const start = position;
    position += total ? origin.cents / total * 100 : 0;
    return `${originColors[index % originColors.length]} ${start}% ${position}%`;
  });
  return <section className={styles.panel} aria-labelledby={titleId}>
    <div className={styles.panelHeading}><h2 id={titleId}>De onde vem minha comissão</h2></div>
    <p className={styles.subheading}>Comissão gerada neste mês, por origem</p>
    <div className={styles.distribution}>
      <div className={styles.donut} style={{ background: total ? `conic-gradient(${segments.join(",")})` : "#e9efea" }} aria-hidden="true">
        <div><strong>{money(total)}</strong><span>gerados no mês</span></div></div>
      <ul className={styles.originList}>{origins.map((origin, index) => <li key={origin.origin}>
        <span className={styles.originLabel}><i style={{ background: originColors[index % originColors.length] }} />{origin.origin}</span>
        <strong>{money(origin.cents)}</strong><small>{Math.round(origin.cents / total * 100)}% do total</small>
      </li>)}{total === 0 && <li className={styles.distributionEmpty}>Os recebimentos registrados vão compor esta visão.</li>}</ul>
    </div>
    <p className={styles.panelFootnote}>Inclui sua participação sobre multas e juros efetivamente recebidos.</p>
  </section>;
}
