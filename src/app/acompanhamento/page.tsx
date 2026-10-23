import { DashboardShell } from "@/components/dashboard-shell";
import { FollowUpList } from "@/components/follow-up-list";
import { requireActiveProfile } from "@/lib/auth/profile";
import { loadFollowUpContracts } from "@/lib/contracts/follow-up-data";

export default async function FollowUpPage() {
  const profile = await requireActiveProfile();
  const contracts = await loadFollowUpContracts(profile);
  return <DashboardShell profile={profile}>
    <p className="eyebrow">HONORÁRIOS FUTUROS</p>
    <h1>Acompanhamento de ações</h1>
    <p className="page-description">Aqui você acompanha seus contratos com honorários futuros ou condicionados, para não perder nenhum valor de vista.
      Esta área reúne contratos apenas no êxito, honorários adicionais sobre proveito econômico e pagamentos que dependem de uma condição para começar.
      Acompanhe o andamento de cada caso para identificar quando haverá valores a cobrar do cliente. Valores a apurar ainda não são recebimentos confirmados.</p>
    <FollowUpList contracts={contracts} role={profile.role} />
  </DashboardShell>;
}
