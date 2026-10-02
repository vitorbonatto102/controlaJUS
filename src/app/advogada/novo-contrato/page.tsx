import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { NewContractForm } from "@/components/new-contract-form";
import { requireRole } from "@/lib/auth/profile";

export default async function NewContractPage() {
  const profile = await requireRole("lawyer");
  return <DashboardShell profile={profile}>
    <Link className="back-link" href="/advogada">← Voltar ao painel</Link>
    <p className="eyebrow">CADASTRO</p><h1>Novo cliente / contrato</h1>
    <p className="page-description">Envie o contrato para preencher os dados automaticamente ou cadastre manualmente.</p>
    <NewContractForm lawyerId={profile.id} />
  </DashboardShell>;
}
