"use client";

import Link from "next/link";
import { useState } from "react";
import type { Role } from "@/lib/auth/roles";
import { filterFollowUpContracts, followUpLabels, followUpReasons, type FollowUpContract } from "@/lib/contracts/follow-up";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import styles from "./follow-up-list.module.css";

const percentage = (value: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;

export function FollowUpList({ contracts, role }: { contracts: FollowUpContract[]; role: Role }) {
  const [reason, setReason] = useState("");
  const [lawyerId, setLawyerId] = useState("");
  const [client, setClient] = useState("");
  const lawyers = [...new Map(contracts.map((contract) => [contract.lawyerId, contract.lawyerName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const filtered = filterFollowUpContracts(contracts, { reason, lawyerId, client });
  return <section className={styles.workspace} aria-label="Contratos em acompanhamento">
    <div className={styles.filters}>
      <label>Tipo de acompanhamento<select value={reason} onChange={(event) => setReason(event.target.value)}>
        <option value="">Todos em acompanhamento</option>
        {Object.entries(followUpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {role !== "lawyer" && <label>Advogada<select value={lawyerId} onChange={(event) => setLawyerId(event.target.value)}>
        <option value="">Todas as advogadas</option>{lawyers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>}
      <label>Cliente<input type="search" value={client} onChange={(event) => setClient(event.target.value)} placeholder="Buscar pelo nome" /></label>
      <button type="button" className="secondary-button" onClick={() => { setReason(""); setLawyerId(""); setClient(""); }}>Limpar filtros</button>
    </div>
    <p className={styles.count} role="status">{filtered.length} {filtered.length === 1 ? "contrato encontrado" : "contratos encontrados"}</p>
    {filtered.length === 0 ? <div className="empty-state">Nenhum contrato encontrado para este acompanhamento.</div> :
      <div className={styles.grid}>{filtered.map((contract) => <article className={styles.card} key={contract.id}>
        <div className={styles.tags}>{followUpReasons(contract).map((item) => <span key={item}>{followUpLabels[item]}</span>)}</div>
        <h2>{contract.clientName}</h2>
        <p className={styles.responsible}>{contract.lawyerName} · Contrato de {formatDateBR(contract.contractDate)}</p>
        <dl>
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
