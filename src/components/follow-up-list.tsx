"use client";

import Link from "next/link";
import { useState } from "react";
import type { Role } from "@/lib/auth/roles";
import { emptyFollowUpFilters, filterFollowUpContracts, followUpLabels, followUpReasons,
  type FollowUpContract, type FollowUpFilters } from "@/lib/contracts/follow-up";
import { formatCpf } from "@/lib/contracts/validation";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import styles from "./follow-up-list.module.css";

const percentage = (value: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;

export function FollowUpList({ contracts, role }: { contracts: FollowUpContract[]; role: Role }) {
  const [filters, setFilters] = useState<FollowUpFilters>(emptyFollowUpFilters);
  const setFilter = (field: keyof FollowUpFilters, value: string) => setFilters((current) => ({ ...current, [field]: value }));
  const lawyers = [...new Map(contracts.map((contract) => [contract.lawyerId, contract.lawyerName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const origins = [...new Set(contracts.map((contract) => contract.origin))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtered = filterFollowUpContracts(contracts, filters);
  const invalidDates = !!filters.dateFrom && !!filters.dateTo && filters.dateFrom > filters.dateTo;
  return <section className={styles.workspace} aria-label="Contratos em acompanhamento">
    <div className={styles.filters} role="group" aria-label="Filtros dos contratos em acompanhamento">
      <label>Tipo de acompanhamento<select value={filters.reason} onChange={(event) => setFilter("reason", event.target.value)}>
        <option value="">Todos em acompanhamento</option>
        {Object.entries(followUpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {role !== "lawyer" && <label>Advogada<select value={filters.lawyerId} onChange={(event) => setFilter("lawyerId", event.target.value)}>
        <option value="">Todas as advogadas</option>{lawyers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>}
      <label>Cliente<input type="search" value={filters.client} onChange={(event) => setFilter("client", event.target.value)} placeholder="Buscar pelo nome" /></label>
      <label>CPF do cliente<input type="search" inputMode="numeric" maxLength={14} value={filters.cpf}
        onChange={(event) => setFilter("cpf", formatCpf(event.target.value))} placeholder="CPF completo ou parte dele" /></label>
      <label>Origem da contratação<select value={filters.origin} onChange={(event) => setFilter("origin", event.target.value)}>
        <option value="">Todas as origens</option>{origins.map((origin) => <option key={origin}>{origin}</option>)}
      </select></label>
      <label>Data do contrato · de<input type="date" value={filters.dateFrom}
        aria-invalid={invalidDates || undefined} aria-describedby={invalidDates ? "follow-up-date-error" : undefined}
        onChange={(event) => setFilter("dateFrom", event.target.value)} /></label>
      <label>Data do contrato · até<input type="date" value={filters.dateTo}
        aria-invalid={invalidDates || undefined} aria-describedby={invalidDates ? "follow-up-date-error" : undefined}
        onChange={(event) => setFilter("dateTo", event.target.value)} /></label>
      <label>Forma de pagamento<select value={filters.paymentMethod} onChange={(event) => setFilter("paymentMethod", event.target.value)}>
        <option value="">Todas as formas</option><option value="cash">À vista</option>
        <option value="installments">Parcelado</option><option value="success_only">Apenas no êxito</option>
      </select></label>
      <label>Valor principal<select value={filters.valueStatus} onChange={(event) => setFilter("valueStatus", event.target.value)}>
        <option value="">Todos</option><option value="known">Com valor definido</option><option value="unknown">A apurar no êxito</option>
      </select></label>
      <label className={styles.termsFilter}>Serviço, condição ou base dos honorários<input type="search" value={filters.terms}
        onChange={(event) => setFilter("terms", event.target.value)} placeholder="Ex.: revisional, alvará, indenização" /></label>
      <button type="button" className="secondary-button" onClick={() => setFilters(emptyFollowUpFilters)}>Limpar filtros</button>
      {invalidDates && <p className={styles.dateError} id="follow-up-date-error" role="alert">A data inicial deve ser anterior ou igual à data final.</p>}
    </div>
    <p className={styles.count} role="status">{filtered.length} {filtered.length === 1 ? "contrato encontrado" : "contratos encontrados"}</p>
    {filtered.length === 0 ? <div className="empty-state">Nenhum contrato encontrado para este acompanhamento.</div> :
      <div className={styles.grid}>{filtered.map((contract) => <article className={styles.card} key={contract.id}>
        <div className={styles.tags}>{followUpReasons(contract).map((item) => <span key={item}>{followUpLabels[item]}</span>)}</div>
        <h2>{contract.clientName}</h2>
        <p className={styles.responsible}>{contract.lawyerName} · Contrato de {formatDateBR(contract.contractDate)}</p>
        <p className={styles.responsible}>CPF: {(contract.contractors?.length ? contract.contractors.map((party) => party.cpf) : [contract.clientCpf])
          .map((cpf) => cpf ? formatCpf(cpf) : "Não informado").join(" / ")} · Origem: {contract.origin}</p>
        <dl>
          <div><dt>Serviço contratado / nome da ação</dt><dd>{contract.serviceName || "Não informado"}</dd></div>
          <div><dt>Valor principal</dt><dd>{contract.totalValue === null ? "A apurar após o êxito" : formatBRL(contract.totalValue)}</dd></div>
          {contract.successFeePercentage !== null && <div><dt>Honorários cobrados do cliente</dt><dd>{percentage(contract.successFeePercentage)} sobre o resultado da ação</dd></div>}
          {contract.has_additional_fee && <div><dt>Honorários adicionais eventuais</dt>
            <dd>{contract.additionalFeePercentage === null ? "Percentual a conferir" : percentage(contract.additionalFeePercentage)} sobre {contract.additionalFeeBasis || "base a conferir"}
              {contract.additionalFeeAmount !== null ? ` · ${formatBRL(contract.additionalFeeAmount)}` : " · valor a apurar"}</dd></div>}
          {contract.paymentCondition && <div><dt>Condição para início dos pagamentos</dt><dd>{contract.paymentCondition}</dd></div>}
        </dl>
        <p className={styles.guidance}>{contract.payment_method === "success_only" ? "Acompanhar o resultado da ação para verificar se haverá honorários a cobrar." :
          "Verificar a ocorrência da condição e a existência de valores eventuais a cobrar."}</p>
        {role === "lawyer" && <Link className="row-link" href={`/advogada/contratos/${contract.id}`}>Ver contrato →</Link>}
        {role === "secretary" && <Link className="row-link" href={`/secretaria/clientes/${contract.clientId}`}>Ver cliente e histórico →</Link>}
      </article>)}</div>}
  </section>;
}
