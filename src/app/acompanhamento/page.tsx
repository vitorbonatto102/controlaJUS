import { DashboardShell } from "@/components/dashboard-shell";
import { FollowUpList } from "@/components/follow-up-list";
import { requireActiveProfile } from "@/lib/auth/profile";
import { loadFollowUpContracts } from "@/lib/contracts/follow-up-data";

export default async function FollowUpPage() {
  const profile = await requireActiveProfile();
  const contracts = await loadFollowUpContracts(profile);
  return <DashboardShell profile={profile}>
    <p className="eyebrow">ACOMPANHAMENTO DE AÇÕES</p>
    <h1>Êxito e condições contratuais</h1>
    <p className="page-description">Acompanhe contratos apenas no êxito, honorários adicionais sobre proveito econômico e pagamentos com início condicionado.
      Valores ainda desconhecidos não compõem parcelas ou saldos a receber.</p>
    <FollowUpList contracts={contracts} role={profile.role} />
  </DashboardShell>;
}
