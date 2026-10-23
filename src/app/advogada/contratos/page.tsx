import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { LawyerContractsTable } from "@/components/contracts/lawyer-contracts-table";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import styles from "@/components/contracts/contract-management.module.css";

export const metadata: Metadata = { title: "Meus contratos | Repassum" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ excluido?: string }> }) {
  const profile = await requireRole("lawyer");
  const [contracts, query] = await Promise.all([loadLawyerContracts(profile.id), searchParams]);
  return <DashboardShell profile={profile}>
    <header className={styles.listHeader}><div><p className="eyebrow">PAINEL DA ADVOGADA</p><h1>Contratos</h1>
      <p>Visualize documentos, edite informações e gerencie os seus contratos.</p></div>
      <Link className="primary-button" href="/advogada/novo-contrato">+ Novo contrato</Link></header>
    {query.excluido === "1" && <div className="success-box" role="status">Contrato excluído das listagens e previsões. Histórico preservado.</div>}
    <LawyerContractsTable contracts={contracts} />
  </DashboardShell>;
}
