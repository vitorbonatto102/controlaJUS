"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { statusLabels, type FinancialRow } from "@/lib/contracts/view";
import { filterWalletRows, monthLabel } from "@/lib/contracts/wallet";

const emptyFilters = { allPeriods: false, status: "", dueDate: "" };

export function LawyerTable({ rows, referenceMonth, today }: {
  rows: FinancialRow[]; referenceMonth: string; today: string;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterWalletRows(rows, { ...filters, referenceMonth }, today),
    [rows, filters, referenceMonth, today]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const setFilter = (key: "status" | "dueDate", value: string) => {
    setFilters((current) => ({ ...current, [key]: value,
      allPeriods: key === "dueDate" && value ? true : current.allPeriods }));
    setPage(1);
  };

  return <section className="table-section" aria-labelledby="receipts-title">
    <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p>
      <h2 id="receipts-title">Meus recebimentos e contratos</h2>
      <p>Valores acumulados por parcela. Cliente e origem seguem os filtros do painel.</p></div>
      <span className="record-count">{filtered.length} {filtered.length === 1 ? "parcela" : "parcelas"}</span>
    </div>
    <div className="filters" aria-label="Filtros das parcelas">
      <label>Vencimentos<select value={filters.allPeriods ? "all" : "reference"} onChange={(event) => {
        setFilters((current) => ({ ...current, allPeriods: event.target.value === "all", dueDate: "" })); setPage(1);
      }}><option value="reference">{monthLabel(referenceMonth)}</option><option value="all">Todos os períodos</option></select></label>
      <label>Status<select value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
        <option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        <option value="delinquent">Inadimplente (inclui parciais)</option>
      </select></label>
      <label>Vencimento exato<input type="date" value={filters.dueDate} onChange={(event) => setFilter("dueDate", event.target.value)} /></label>
      <button className="clear-button" type="button" onClick={() => { setFilters(emptyFilters); setPage(1); }}>Limpar filtros</button>
    </div>
    {rows.length === 0 ? <div className="empty-state"><h3>Nenhuma parcela com cronograma definido</h3>
      <p>Confira os filtros. Contratos apenas no êxito ou ainda sem data ficam em Acompanhamento.</p>
      <Link className="primary-button" href="/advogada/novo-contrato">+ Novo cliente / contrato</Link></div> :
      filtered.length === 0 ? <div className="empty-state"><h3>Nenhuma parcela encontrada</h3>
        <p>Ajuste ou limpe os filtros para ver outros períodos e contratos.</p></div> :
      <><div className="table-scroll"><table className="financial-table"><thead><tr>
        <th>Cliente</th><th>Origem</th><th>Parcela</th><th>Vencimento</th>
        <th>Valor contratual</th><th>Valor efetivamente pago</th><th>Diferença</th><th>Último pagamento</th>
        <th>Minha %</th><th>Participação contratada</th><th>Comissão efetiva registrada</th><th>Status</th><th>Ações</th>
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
