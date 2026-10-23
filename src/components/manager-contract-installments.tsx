import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { buildOperationalRows, operationalStatusLabels,
  type OperationalContract, type OperationalRow } from "@/lib/secretary/view";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import styles from "./manager-contract-installments.module.css";

const PAGE_SIZE = 5;
const filters = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendentes" },
  { value: "overdue", label: "Atrasadas" },
  { value: "paid", label: "Pagas" },
] as const;
type InstallmentFilter = typeof filters[number]["value"];
type Editor = { installmentId: string; source: "highlight" | "table" };
const money = (cents: number) => formatBRL(cents / 100);
const installmentTitle = (row: OperationalRow) =>
  row.installmentLabel === "Entrada" ? "Entrada" : `Parcela ${row.installmentLabel}`;

function CorrectionPanel({ id, row, children, onClose }: {
  id: string; row: OperationalRow; children: ReactNode; onClose: () => void;
}) {
  return <div id={id} className={styles.editor}>
    <div className={styles.editorHeading}>
      <h4>Correções · {installmentTitle(row)}</h4>
      <button type="button" className={styles.textButton} onClick={onClose}>Fechar correções</button>
    </div>
    {children}
  </div>;
}

export function ManagerContractInstallments({ contract, today, renderCorrection }: {
  contract: OperationalContract; today: string; renderCorrection: (row: OperationalRow) => ReactNode;
}) {
  const id = useId();
  const rows = useMemo(() => buildOperationalRows([contract], [], today), [contract, today]);
  const [showList, setShowList] = useState(false);
  const [filter, setFilter] = useState<InstallmentFilter>("all");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null);
  const pending = rows.filter((row) => row.balanceCents > 0);
  const overdue = pending.filter((row) => row.dueDate < today).length;
  const dueToday = pending.filter((row) => row.dueDate === today).length;
  const upcoming = pending.length - overdue - dueToday;
  const highlight = pending[0];
  const filtered = rows.filter((row) => filter === "all" ||
    (filter === "pending" && row.balanceCents > 0) ||
    (filter === "overdue" && row.balanceCents > 0 && row.dueDate < today) ||
    (filter === "paid" && row.status === "paid"));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const isEditing = (row: OperationalRow, source: Editor["source"]) =>
    editor?.installmentId === row.installmentId && editor.source === source;
  function toggleEditor(row: OperationalRow, source: Editor["source"]) {
    setEditor(isEditing(row, source) ? null : { installmentId: row.installmentId, source });
  }

  return <section className={styles.section} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Parcelas do contrato</h3>
    {!rows.length ? <p>Nenhuma parcela com vencimento definido.</p> : <>
      <ul className={styles.counts} aria-label="Resumo das parcelas">
        <li><strong>{rows.length}</strong> {rows.length === 1 ? "parcela" : "parcelas"}</li>
        <li><strong>{rows.length - pending.length}</strong> {rows.length - pending.length === 1 ? "paga" : "pagas"}</li>
        <li className={overdue ? styles.overdue : undefined}><strong>{overdue}</strong> em atraso</li>
        {dueToday > 0 && <li><strong>{dueToday}</strong> {dueToday === 1 ? "vence hoje" : "vencem hoje"}</li>}
        <li><strong>{upcoming}</strong> a vencer</li>
      </ul>
      {highlight ? <>
        <div className={`${styles.highlight} ${highlight.dueDate < today ? styles.highlightOverdue : ""}`}>
          <div className={styles.highlightIdentity}>
            <span className={styles.highlightLabel}>{highlight.dueDate < today ? "Parcela mais antiga em atraso" :
              highlight.dueDate === today ? "Parcela com vencimento hoje" : "Próxima parcela a vencer"}</span>
            <h4>{installmentTitle(highlight)}</h4>
            <span>Vencimento: <time dateTime={highlight.dueDate}>{formatDateBR(highlight.dueDate)}</time></span>
            {highlight.status === "partial" && <span>Parcialmente paga · recebido {money(highlight.paidCents)}</span>}
          </div>
          <div className={styles.highlightAmount}><span>Saldo da parcela</span><strong>{money(highlight.balanceCents)}</strong></div>
          <button type="button" className="secondary-button"
            aria-expanded={isEditing(highlight, "highlight")} aria-controls={`${id}-highlight-editor`}
            aria-label={`Corrigir ${installmentTitle(highlight).toLocaleLowerCase("pt-BR")} em destaque`}
            onClick={() => toggleEditor(highlight, "highlight")}>Corrigir</button>
        </div>
        {isEditing(highlight, "highlight") && <CorrectionPanel key={highlight.installmentId}
          id={`${id}-highlight-editor`} row={highlight} onClose={() => setEditor(null)}>
          {renderCorrection(highlight)}
        </CorrectionPanel>}
      </> : <p className={styles.settled}>Todas as parcelas estão pagas.</p>}
      <button type="button" className={styles.listToggle} aria-expanded={showList} aria-controls={`${id}-list`}
        onClick={() => { setShowList(!showList); setEditor(null); }}>
        {showList ? "Ocultar parcelas" : "Ver parcelas"} ({rows.length})
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={showList ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {showList && <div id={`${id}-list`} className={styles.list}>
        <div className={styles.toolbar}>
          <label>Situação das parcelas<select value={filter} onChange={(event) => {
            setFilter(event.target.value as InstallmentFilter); setPage(1); setEditor(null);
          }}>{filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <span className={styles.hint}>Pendentes inclui todas as parcelas com saldo em aberto.</span>
        </div>
        {filtered.length ? <>
          <div className="table-scroll"><table className={`data-table ${styles.table}`}>
            <caption className={styles.caption}>Cronograma de parcelas · {contract.client_name}</caption>
            <thead><tr><th scope="col">Parcela</th><th scope="col">Vencimento</th><th scope="col">Valor contratual</th>
              <th scope="col">Recebido</th><th scope="col">Saldo</th><th scope="col">Situação</th><th scope="col">Ação</th></tr></thead>
            <tbody>{visible.map((row) => <Fragment key={row.installmentId}>
              <tr className={isEditing(row, "table") ? styles.selectedRow : undefined}>
                <th scope="row">{row.installmentLabel}</th><td>{formatDateBR(row.dueDate)}</td>
                <td className={styles.money}>{money(row.contractualCents)}</td><td className={styles.money}>{money(row.paidCents)}</td>
                <td className={styles.money}>{money(row.balanceCents)}</td>
                <td><span className={`status status-${row.status}`}>{operationalStatusLabels[row.status]}</span>
                  {row.status === "partial" && row.dueDate < today && <small>Saldo em atraso</small>}</td>
                <td><button type="button" className={styles.textButton} aria-expanded={isEditing(row, "table")}
                  aria-controls={`${id}-table-editor-${row.installmentId}`}
                  aria-label={`Corrigir ${installmentTitle(row).toLocaleLowerCase("pt-BR")}`}
                  onClick={() => toggleEditor(row, "table")}>{isEditing(row, "table") ? "Fechar" : "Corrigir"}</button></td>
              </tr>
              {isEditing(row, "table") && <tr><td colSpan={7} className={styles.editorCell}>
                <CorrectionPanel id={`${id}-table-editor-${row.installmentId}`} row={row} onClose={() => setEditor(null)}>
                  {renderCorrection(row)}
                </CorrectionPanel>
              </td></tr>}
            </Fragment>)}</tbody>
          </table></div>
          <div className={styles.pagination} aria-label="Paginação das parcelas">
            <span role="status">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length} · Página {currentPage} de {pageCount}</span>
            {pageCount > 1 && <div><button type="button" disabled={currentPage === 1} onClick={() => {
              setPage(currentPage - 1); setEditor(null);
            }}>Anterior</button><button type="button" disabled={currentPage === pageCount} onClick={() => {
              setPage(currentPage + 1); setEditor(null);
            }}>Próxima</button></div>}
          </div>
        </> : <p className={styles.empty} role="status">Nenhuma parcela neste filtro.</p>}
      </div>}
    </>}
  </section>;
}
