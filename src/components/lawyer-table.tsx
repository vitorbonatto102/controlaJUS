"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { filterFinancialRows, statusLabels, type FinancialRow, type TableFilters } from "@/lib/contracts/view";

const emptyFilters: TableFilters = { month: "", year: "", clientId: "", origin: "", status: "" };
const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function LawyerTable({ rows }: { rows: FinancialRow[] }) {
  const [filters, setFilters] = useState<TableFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const clients = useMemo(() => [...new Map(rows.map((row) => [row.clientId,
    { id: row.clientId, name: row.clientName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [rows]);
  const origins = useMemo(() => [...new Set(rows.map((row) => row.origin))].sort(), [rows]);
  const years = useMemo(() => [...new Set(rows.map((row) => row.dueDate.slice(0, 4)))].sort().reverse(), [rows]);
  const filtered = useMemo(() => filterFinancialRows(rows, filters), [rows, filters]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const setFilter = (key: keyof TableFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  return <section className="table-section" aria-labelledby="receipts-title">
    <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p>
      <h2 id="receipts-title">Meus recebimentos e contratos</h2>
      <p>Valores previstos e recebimentos registrados para os seus contratos.</p></div>
      <span className="record-count">{filtered.length} {filtered.length === 1 ? "parcela" : "parcelas"}</span>
    </div>
    {rows.length > 0 && <div className="filters" aria-label="Filtros da tabela">
      <label>Mês<select value={filters.month} onChange={(event) => setFilter("month", event.target.value)}>
        <option value="">Todos</option>{months.map((month, index) => <option key={month} value={String(index + 1).padStart(2, "0")}>{month}</option>)}
      </select></label>
      <label>Ano<select value={filters.year} onChange={(event) => setFilter("year", event.target.value)}>
        <option value="">Todos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}
      </select></label>
      <label>Cliente<select value={filters.clientId} onChange={(event) => setFilter("clientId", event.target.value)}>
        <option value="">Todos</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select></label>
      <label>Origem<select value={filters.origin} onChange={(event) => setFilter("origin", event.target.value)}>
        <option value="">Todas</option>{origins.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
      </select></label>
      <label>Status<select value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
        <option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button className="clear-button" type="button" onClick={() => { setFilters(emptyFilters); setPage(1); }}>Limpar filtros</button>
    </div>}
    {rows.length === 0 ? <div className="empty-state"><h3>Nenhum contrato cadastrado</h3>
      <p>Cadastre seu primeiro cliente e contrato para acompanhar as parcelas aqui.</p>
      <Link className="primary-button" href="/advogada/novo-contrato">+ Novo cliente / contrato</Link></div> :
      filtered.length === 0 ? <div className="empty-state"><h3>Nenhuma parcela encontrada</h3>
        <p>Ajuste ou limpe os filtros para ver outros períodos e contratos.</p></div> :
      <><div className="table-scroll"><table className="financial-table"><thead><tr>
        <th>Cliente</th><th>Origem</th><th>Parcela</th><th>Vencimento</th>
        <th>Valor contratual</th><th>Valor efetivamente pago</th><th>Diferença</th><th>Data do pagamento</th>
        <th>Minha %</th><th>Participação estimada</th><th>Comissão efetiva</th><th>Status</th><th>Ações</th>
      </tr></thead><tbody>{visible.map((row) => <tr key={row.installmentId}>
        <td className="client-cell">{row.clientName}</td><td>{row.origin}</td>
        <td>{row.installmentLabel}</td><td>{formatDateBR(row.dueDate)}</td>
        <td className="money-cell">{formatBRL(row.contractualCents / 100)}</td>
        <td className="money-cell">{row.paidCents === null ? "—" : formatBRL(row.paidCents / 100)}</td>
        <td className="money-cell">{row.differenceCents === null ? "—" : formatBRL(row.differenceCents / 100)}</td>
        <td>{row.latestPaymentDate ? formatDateBR(row.latestPaymentDate) : "—"}</td>
        <td>{row.percentage}%</td><td className="money-cell">{formatBRL(row.estimatedCents / 100)}</td>
        <td className="money-cell">{row.commissionCents === null ? "—" : formatBRL(row.commissionCents / 100)}</td>
        <td><span className={`status status-${row.status}`}>{statusLabels[row.status]}</span></td>
        <td><Link className="row-link" href={`/advogada/contratos/${row.contractId}`}>Ver contrato</Link></td>
      </tr>)}</tbody></table></div>
      {pageCount > 1 && <div className="pagination"><span>Página {page} de {pageCount}</span>
        <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
        <button type="button" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Próxima</button>
      </div>}</>}
  </section>;
}
