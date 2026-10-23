import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { EditContractForm } from "@/components/contracts/edit-contract-form";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContract } from "@/lib/contracts/data";
import { contractHasPayments } from "@/lib/contracts/editing";
import { hasInstallmentNotes } from "@/lib/contracts/management-data";

export const metadata: Metadata = { title: "Editar contrato | Repassum" };

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("lawyer");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const contract = await loadLawyerContract(profile.id, id);
  if (!contract) notFound();
  const financialLocked = contractHasPayments(contract) || await hasInstallmentNotes(id);
  return <DashboardShell profile={profile}>
    <Link className="back-link" href={`/advogada/contratos/${id}`}>← Voltar ao contrato</Link>
    <p className="eyebrow">MEUS CONTRATOS</p><h1>Editar contrato</h1>
    <p className="page-description">{contract.client_name} · Confira as informações antes de salvar. As alterações ficam registradas em auditoria.</p>
    <EditContractForm contract={contract} lawyerId={profile.id} financialLocked={financialLocked} />
  </DashboardShell>;
}
