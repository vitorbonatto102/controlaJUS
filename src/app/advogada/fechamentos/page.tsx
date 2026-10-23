import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ClosingStatusNotice } from "@/components/closing-status-notice";
import { FinancialCard } from "@/components/financial-card";
import { WalletSettlements } from "@/components/wallet/wallet-settlements";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { buildWallet, monthLabel } from "@/lib/contracts/wallet";
import { closingAvailability } from "@/lib/finance/closing-period";
import { loadClosings, loadLawyerTransfers } from "@/lib/finance/data";
import { formatBRL } from "@/lib/formatters";
import styles from "@/components/wallet/wallet.module.css";

export const metadata: Metadata = { title: "Fechamentos e repasses | Repassum" };

export default async function ClosingsPage() {
  const profile = await requireRole("lawyer");
  const [contracts, closings, transfers] = await Promise.all([
    loadLawyerContracts(profile.id), loadClosings(profile.id), loadLawyerTransfers(profile.id),
  ]);
  const today = todayInSaoPaulo();
  const referenceMonth = today.slice(0, 7);
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const currentClosing = closings.find((closing) => closing.reference_year === year && closing.reference_month === month);
  const wallet = buildWallet(contracts, today, referenceMonth);
  const availability = closingAvailability(year, month, today);

  return <DashboardShell profile={profile}><div className={styles.wallet}>
    <header className={styles.heading}><div><p className="eyebrow">MEU FINANCEIRO</p>
      <h1>Fechamentos e repasses</h1>
      <p className={styles.description}>Acompanhe a apuração do mês, os períodos confirmados e os valores repassados a você.</p></div>
      <Link className="secondary-button" href="/advogada/carteira">Abrir minha carteira →</Link></header>
    {(!currentClosing || currentClosing.status === "draft") && <section className={styles.panel} aria-labelledby="current-closing-title">
      <h2 id="current-closing-title">Apuração atual · {monthLabel(referenceMonth)}</h2>
      <ClosingStatusNotice {...availability} today={today} audience="lawyer" />
      <div className="card-grid">
        <FinancialCard title="Recebido dos meus clientes no mês" value={formatBRL(wallet.current.receivedCents / 100)}
          hint="Valores recebidos pelo escritório, pela data do pagamento registrado." />
        <FinancialCard title="Minha comissão em apuração" value={formatBRL(wallet.current.generatedCents / 100)}
          hint="Participação já gerada nos recebimentos. Aguarda a confirmação do gestor." />
      </div>
      <p className={styles.description} style={{ marginTop: 16 }}>Prévia do mês: os valores acompanham os recebimentos e as correções registrados até o fechamento.</p>
    </section>}
    <WalletSettlements closings={closings} transfers={transfers} />
  </div></DashboardShell>;
}
