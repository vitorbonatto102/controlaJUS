"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ContractRecord } from "@/lib/contracts/view";
import { contractHasPayments } from "@/lib/contracts/editing";
import { contractClientLabel } from "@/lib/contracts/parties";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { ContractActions } from "./contract-actions";
import styles from "./contract-management.module.css";

const methods = { cash: "À vista", installments: "Parcelado", success_only: "Apenas no êxito" };

export function LawyerContractsTable({ contracts }: { contracts: ContractRecord[] }) {
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);
  const origins = useMemo(() => [...new Set(contracts.map((contract) => contract.origin))].sort(), [contracts]);
  const filtered = useMemo(() => contracts.filter((contract) =>
    `${contractClientLabel(contract)} ${contract.service_name ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")) &&
    (!origin || contract.origin === origin) && (!method || contract.payment_method === method))
    .sort((a, b) => b.contract_date.localeCompare(a.contract_date) || a.client_name.localeCompare(b.client_name, "pt-BR")),
  [contracts, search, origin, method]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pageCount);
  return <section className="table-section" aria-labelledby="contracts-list-title"><div className="section-heading"><div>
    <p className="eyebrow">CADASTROS</p><h2 id="contracts-list-title">Meus contratos</h2>
    <p>Inclui contratos com parcelas, apenas no êxito e com início condicionado.</p></div>
    <span className="record-count">{filtered.length} contratos</span></div>
    <div className={styles.filters} role="group" aria-label="Filtros dos contratos"><label>Cliente ou serviço
      <input type="search" placeholder="Nome do cliente ou da ação" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <label>Origem<select value={origin} onChange={(event) => { setOrigin(event.target.value); setPage(1); }}>
        <option value="">Todas</option>{origins.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Forma de pagamento<select value={method} onChange={(event) => { setMethod(event.target.value); setPage(1); }}>
        <option value="">Todas</option>{Object.entries(methods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="clear-button" type="button" onClick={() => { setSearch(""); setOrigin(""); setMethod(""); setPage(1); }}>Limpar filtros</button></div>
    {filtered.length ? <><div className="table-scroll"><table className="financial-table"><thead><tr>
      <th>Contratantes</th><th>Serviço contratado</th><th>Data do contrato</th><th>Origem</th><th>Forma de pagamento</th><th>Valor contratado</th><th>PDF</th><th>Ações</th>
    </tr></thead><tbody>{filtered.slice((currentPage - 1) * 20, currentPage * 20).map((contract) => <tr key={contract.id}>
      <td className="client-cell">{contractClientLabel(contract)}</td><td>{contract.service_name || "Não informado"}</td>
      <td>{formatDateBR(contract.contract_date)}</td><td>{contract.origin}</td>
      <td>{contract.payment_method ? methods[contract.payment_method] : "Não informada"}</td>
      <td className="money-cell">{contract.total_contract_value === null ? "A apurar no êxito" : formatBRL(contract.total_contract_value)}</td>
      <td>{contract.contract_file_path ? <a className="row-link" href={`/advogada/contratos/${contract.id}/pdf`} target="_blank" rel="noopener noreferrer">Abrir PDF ↗</a> : "Sem PDF"}</td>
      <td><ContractActions id={contract.id} version={contract.updated_at ?? ""} hasPayments={contractHasPayments(contract)} /></td>
    </tr>)}</tbody></table></div>{pageCount > 1 && <div className="pagination"><span>Página {currentPage} de {pageCount}</span>
      <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</button></div>}</> :
      <div className="empty-state"><h3>{contracts.length ? "Nenhum contrato encontrado" : "Nenhum contrato cadastrado"}</h3>
        <p>{contracts.length ? "Ajuste os filtros para ver outros contratos." : "Cadastre um contrato para começar."}</p>
        {!contracts.length && <Link className="primary-button" href="/advogada/novo-contrato">+ Novo contrato</Link>}</div>}
  </section>;
}
