import Link from "next/link";
import { RepassumLogo } from "@/components/brand";
import type { ReportDocument } from "@/lib/reports/model";
import { DownloadReport } from "./download-report";
import styles from "./reports.module.css";

export function ReportPreview({ report, pdfHref, page = 1, pageHref }: { report: ReportDocument; pdfHref: string;
  page?: number; pageHref?: (page: number) => string }) {
  const rows = report.sections[0]?.rows ?? [], pageCount = Math.max(1, Math.ceil(rows.length / 40));
  const current = Math.min(pageCount, Math.max(1, page));
  return <section className={styles.preview} aria-labelledby="report-preview-title">
    <header className={styles.previewHeader}><RepassumLogo /><span>Uso interno · {report.period}</span></header>
    <div className={styles.previewHeading}><div><h2 id="report-preview-title">{report.title}</h2><p>{report.officeName} · {report.audience}</p></div>
      <DownloadReport href={pdfHref} /></div>
    <p className={styles.scope}>{report.filters.join(" · ")}</p>
    <div className={styles.metrics}>{report.metrics.map(metric => <article key={metric.label}><h3>{metric.label}</h3><strong>{metric.value}</strong>
      {metric.hint && <small>{metric.hint}</small>}</article>)}</div>
    <div className="table-scroll"><table className={styles.reportTable}><thead><tr>{report.sections[0].columns.map(column =>
      <th key={column.label} scope="col" className={column.align === "right" ? styles.money : undefined}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.slice((current - 1) * 40, current * 40).map((row, index) => <tr key={index}>{row.map((cell, column) =>
        <td key={column} className={report.sections[0].columns[column].align === "right" ? styles.money : undefined}>{cell}</td>)}</tr>)}</tbody></table></div>
    {!rows.length && <div className={styles.empty}><h3>Nenhum registro neste filtro</h3><p>Você pode ajustar as datas ou consultar outro cliente.</p></div>}
    <div className={styles.pagination}><span>{rows.length ? `${Math.min(rows.length, (current - 1) * 40 + 1)}–${Math.min(rows.length, current * 40)} de ${rows.length} ${rows.length === 1 ? "registro" : "registros"}` : "0 registros"}</span>
      {pageCount > 1 && pageHref && <nav aria-label="Páginas da prévia">{current > 1 && <Link href={pageHref(current - 1)}>Anterior</Link>}
        <span>{current} / {pageCount}</span>{current < pageCount && <Link href={pageHref(current + 1)}>Próxima</Link>}</nav>}</div>
    <p className={styles.hint}>O PDF contém todos os registros dos filtros aplicados, incluindo os de outras páginas da prévia.</p>
    <details className={styles.explanation}><summary>Como interpretar este relatório</summary><ul>{report.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
  </section>;
}
