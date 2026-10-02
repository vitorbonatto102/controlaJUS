import { DashboardShell } from "@/components/dashboard-shell";
import { ManagerDashboard } from "@/components/manager-dashboard";
import { requireRole } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { loadManagerWorkspace } from "@/lib/manager/data";

export default async function ManagerPage() {
  const profile = await requireRole("manager");
  const data = await loadManagerWorkspace();
  return <DashboardShell profile={profile}>
    <p className="eyebrow">PAINEL DE GESTÃO</p>
    <h1>Olá, {profile.full_name.trim().split(/\s+/)[0]}</h1>
    <p className="page-description">Acompanhe recebimentos, comissões e repasses da equipe.</p>
    <ManagerDashboard data={data} today={todayInSaoPaulo()} />
  </DashboardShell>;
}
