"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { LawyerTable } from "@/components/lawyer-table";
import { followUpReasons } from "@/lib/contracts/follow-up";
import { buildWallet, monthLabel, walletBalance, type WalletTransfer } from "@/lib/contracts/wallet";
import type { ContractRecord } from "@/lib/contracts/view";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { MonthlyOutlook, OriginChart, ParticipationChart } from "./wallet-charts";
import styles from "./wallet.module.css";

const money = (cents: number) => formatBRL(cents / 100);

function Metric({ title, value, hint, positive = false }: {
  title: string; value: string; hint: string; positive?: boolean;
}) {
  return <article className={styles.card}><h3>{title}</h3>
    <strong className={`${styles.cardValue} ${positive ? styles.positive : ""}`}>{value}</strong><p>{hint}</p></article>;
}

export function LawyerWallet({ contracts, transfers, today, children }: {
  contracts: ContractRecord[]; transfers: WalletTransfer[]; today: string; children: ReactNode;
}) {
  const [referenceMonth, setReferenceMonth] = useState(today.slice(0, 7));
  const [clientId, setClientId] = useState("");
  const [origin, setOrigin] = useState("");
  const balance = useMemo(() => walletBalance(contracts, transfers), [contracts, transfers]);
  const clients = useMemo(() => [...new Map(contracts.map((contract) => [contract.client_id,
    { id: contract.client_id, name: contract.client_name }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [contracts]);
  const origins = useMemo(() => [...new Set(contracts.map((contract) => contract.origin))].sort(), [contracts]);
  const filteredContracts = useMemo(() => contracts.filter((contract) =>
    (!clientId || contract.client_id === clientId) && (!origin || contract.origin === origin)), [contracts, clientId, origin]);
  const wallet = useMemo(() => buildWallet(filteredContracts, today, referenceMonth), [filteredContracts, today, referenceMonth]);
  const followUpCount = filteredContracts.filter((contract) => followUpReasons(contract).length > 0).length;

  return <div className={styles.wallet}>
    <header className={styles.heading}><div><p className="eyebrow">PAINEL DA ADVOGADA / CARTEIRA</p>
      <h1>Minha carteira</h1><p className={styles.description}>Seus contratos, previsões, recebimentos e repasses em um só lugar.</p></div>
      <Link className="secondary-button" href="/advogada/novo-contrato">+ Novo contrato</Link></header>

    <section className={styles.balance} aria-label="Saldo total da carteira">
      <div><p className={styles.balanceLabel}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="5" width="18" height="15" rx="3" /><path d="M16 10h5v6h-5a3 3 0 0 1 0-6Z" /></svg>
        Saldo de comissões a repassar</p><strong className={styles.balanceValue}>{money(balance.pendingCents)}</strong>
        <p className={styles.balanceNote}>Carteira completa · comissões geradas menos repasses válidos.<br />
          {balance.overpaidCents > 0 ? `Excesso de repasse a regularizar: ${money(balance.overpaidCents)}.` : "Inclui valores em apuração, ainda não fechados."}</p></div>
      <div className={styles.balanceStat}><span>Comissões geradas · total</span><strong>{money(balance.generatedCents)}</strong></div>
      <div className={styles.balanceStat}><span>Já repassado para mim · total</span><strong>{money(balance.transferredCents)}</strong></div>
    </section>

    <div className={styles.filters} role="group" aria-label="Filtros do dashboard financeiro">
      <label>Mês de referência<input type="month" value={referenceMonth} onChange={(event) => {
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setReferenceMonth(event.target.value);
      }} /></label>
      <label>Cliente<select value={clientId} onChange={(event) => setClientId(event.target.value)}>
        <option value="">Todos os meus clientes</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select></label>
      <label>Origem<select value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option value="">Todas as origens</option>{origins.map((item) => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <button className="clear-button" type="button" onClick={() => { setReferenceMonth(today.slice(0, 7)); setClientId(""); setOrigin(""); }}>Limpar filtros</button>
      <p className={styles.filterHint}>Cliente e origem filtram os indicadores, gráficos e parcelas abaixo. O saldo de repasses e os fechamentos são da carteira completa, pois os repasses são feitos por fechamento.</p>
    </div>

    <div className={styles.period}><h2>Seu panorama · {monthLabel(referenceMonth)}</h2>
      <span>Posição dos saldos em {formatDateBR(today)}</span></div>
    <section className={styles.cards} aria-label="Indicadores financeiros do período">
      <Metric title="Contratos fechados no mês anterior" value={String(wallet.previousContractCount)}
        hint={`${monthLabel(wallet.previousMonth)} · ${money(wallet.previousContractedCents)} em valores conhecidos${wallet.previousUnknownCount ? `; ${wallet.previousUnknownCount} a apurar` : ""}.`} />
      <Metric title="Recebido dos meus clientes no mês" value={money(wallet.current.receivedCents)}
        hint="Valor efetivamente recebido pelo escritório, pela data de cada pagamento." />
      <Metric title="Minha comissão gerada no mês" value={money(wallet.current.generatedCents)} positive
        hint="Sua participação nos pagamentos do período. Ainda pode estar aguardando repasse." />
      <Metric title="Minha previsão para o próximo mês" value={money(wallet.next.remainingParticipationCents)} positive
        hint={`${monthLabel(wallet.next.month)} · participação sobre parcelas ainda não pagas. Não é repasse confirmado.`} />
      <Metric title="Minha participação em atraso" value={money(wallet.overdueParticipationCents)}
        hint={`${wallet.overdueCount} parcelas com saldo vencido até hoje. Estimativa; ainda não é comissão gerada.`} />
    </section>

    <section className={styles.panel} aria-label="Totais da carteira filtrada"><div className={styles.period}>
      <h2>Valores acumulados dos meus contratos</h2><span>Todos os períodos · cliente e origem selecionados</span></div>
      <div className={styles.totals}><div><span>Valor contratado conhecido</span><strong>{money(wallet.totalContractedCents)}</strong></div>
        <div><span>Minha participação contratada · valores conhecidos</span><strong>{money(wallet.contractedParticipationCents)}</strong></div>
        <div><span>Total recebido dos clientes</span><strong>{money(wallet.receivedCents)}</strong></div></div>
    </section>

    <div className={styles.charts}><ParticipationChart months={wallet.timeline} referenceMonth={referenceMonth} />
      <OriginChart origins={wallet.origins} total={wallet.contractedParticipationCents} /></div>
    <MonthlyOutlook months={wallet.outlook} />

    {wallet.overdueCount > 0 && <section className={styles.alert}><div><h2>Recebíveis que precisam de atenção</h2>
      <p>{wallet.overdueCount} parcelas ainda têm saldo vencido. O valor ao lado é o saldo dos clientes; sua participação estimada aparece no indicador acima.</p></div>
      <strong>{money(wallet.overdueCents)}</strong></section>}
    {wallet.missingCommissionCount > 0 && <p className={styles.description} role="status">Há {wallet.missingCommissionCount} recebimentos sem comissão registrada. Eles entram no total recebido dos clientes, mas aguardam apuração da sua comissão.</p>}
    {followUpCount > 0 && <section className={styles.followUp}><div><h2>Valores que dependem do andamento da ação</h2>
      <p>{followUpCount} contratos com êxito, adicionais ou início condicionado. Valores ainda não definidos ou sem cronograma não entram na previsão mensal.</p></div>
      <Link className="row-link" href="/acompanhamento">Ver acompanhamento →</Link></section>}

    <LawyerTable key={`${referenceMonth}:${clientId}:${origin}`} rows={wallet.rows} referenceMonth={referenceMonth} today={today} />
    {children}
  </div>;
}
