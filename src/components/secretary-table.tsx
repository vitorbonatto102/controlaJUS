"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { filterOperationalRows, operationalStatusLabels, type LawyerOption,
  type OperationalFilters, type OperationalRow } from "@/lib/secretary/view";

const blank: OperationalFilters = { lawyerId: "", clientId: "", month: "", year: "", status: "", dueDate: "", origin: "" };
const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function SecretaryTable({ rows, lawyers, today }: {
  rows: OperationalRow[]; lawyers: LawyerOption[]; today: string;
}) {
  const [filters, setFilters] = useState<OperationalFilters>(blank);
  const [page, setPage] = useState(1);
  const clients = useMemo(() => [...new Map(rows.map((row) => [row.clientId,
    { id: row.clientId, name: row.clientName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [rows]);
  const years = useMemo(() => [...new Set(rows.map((row) => row.dueDate.slice(0, 4)))].sort().reverse(), [rows]);
  const origins = useMemo(() => [...new Set(rows.map((row) => row.origin))].sort(), [rows]);
  const filtered = useMemo(() => filterOperationalRows(rows, filters, today), [rows, filters, today]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const setFilter = (key: keyof OperationalFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value })); setPage(1);
  };
  return <section className="table-section" aria-labelledby="secretary-records-title">
    <div className="section-heading"><div><p className="eyebrow">ROTINA OPERACIONAL</p>
      <h2 id="secretary-records-title">Parcelas e recebimentos</h2>
      <p>Valores dos clientes em relação ao escritório.</p></div>
      <span className="record-count">{filtered.length} {filtered.length === 1 ? "parcela" : "parcelas"}</span>
    </div>
    <div className="filters secretary-filters" aria-label="Filtros operacionais">
      <label>Advogada<select value={filters.lawyerId} onChange={(e) => setFilter("lawyerId", e.target.value)}>
        <option value="">Todas</option>{lawyers.map((lawyer) => <option key={lawyer.id} value={lawyer.id}>{lawyer.full_name}</option>)}
      </select></label>
      <label>Cliente<select value={filters.clientId} onChange={(e) => setFilter("clientId", e.target.value)}>
        <option value="">Todos</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select></label>
      <label>Mês<select value={filters.month} onChange={(e) => setFilter("month", e.target.value)}>
        <option value="">Todos</option>{months.map((month, i) => <option key={month} value={String(i + 1).padStart(2, "0")}>{month}</option>)}
      </select></label>
      <label>Ano<select value={filters.year} onChange={(e) => setFilter("year", e.target.value)}>
        <option value="">Todos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}
      </select></label>
      <label>Status<select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
        <option value="">Todos</option>{Object.entries(operationalStatusLabels).map(([key, value]) =>
          <option key={key} value={key}>{value}</option>)}<option value="delinquent">Inadimplente</option>
      </select></label>
      <label>Vencimento<input type="date" value={filters.dueDate} onChange={(e) => setFilter("dueDate", e.target.value)} /></label>
      <label>Origem<select value={filters.origin} onChange={(e) => setFilter("origin", e.target.value)}>
        <option value="">Todas</option>{origins.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
      </select></label>
      <button className="clear-button" type="button" onClick={() => { setFilters(blank); setPage(1); }}>Limpar filtros</button>
    </div>
    {filtered.length === 0 ? <div className="empty-state"><h3>Nenhuma parcela encontrada</h3>
      <p>Confira ou limpe os filtros para ver outros registros.</p></div> : <>
      <div className="table-scroll"><table className="financial-table secretary-table"><thead><tr>
        <th>Advogada</th><th>Cliente</th><th>Parcela</th><th>Vencimento</th>
        <th>Valor contratual</th><th>Valor pago</th><th>Pagamento</th><th>Status</th>
        <th>Última cobrança</th><th>Ações</th>
      </tr></thead><tbody>{visible.map((row) => <tr key={row.installmentId}>
        <td>{row.lawyerName}</td><td className="client-cell">{row.clientName}</td>
        <td>{row.installmentLabel}</td><td>{formatDateBR(row.dueDate)}</td>
        <td className="money-cell">{formatBRL(row.contractualCents / 100)}</td>
        <td className="money-cell">{row.paidCents ? formatBRL(row.paidCents / 100) : "—"}</td>
        <td>{row.latestPaymentDate ? formatDateBR(row.latestPaymentDate) : "—"}</td>
        <td><span className={`status status-${row.status}`}>{operationalStatusLabels[row.status]}</span></td>
        <td>{row.latestContactAt ? <Link className="row-link" href={`/secretaria/clientes/${row.clientId}#historico`}>
          {formatDateBR(new Date(row.latestContactAt))}</Link> : "—"}</td>
        <td><Link className="row-link" href={`/secretaria/clientes/${row.clientId}#parcela-${row.installmentId}`}>
          Abrir cliente</Link></td>
      </tr>)}</tbody></table></div>
      {pageCount > 1 && <div className="pagination"><span>Página {page} de {pageCount}</span>
        <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
        <button type="button" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Próxima</button>
      </div>}</>}
  </section>;
}
