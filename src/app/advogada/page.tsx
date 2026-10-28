import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import { LawyerOverview } from "@/components/overview/lawyer-overview";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import { contractClientLabel } from "@/lib/contracts/parties";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { loadClosings, loadLawyerTransfers, loadNotifications } from "@/lib/finance/data";
import { loadMonthlyContractGoal } from "@/lib/dashboard/data";
import { buildLawyerOverview } from "@/lib/dashboard/lawyer-overview";

export const metadata: Metadata = { title: "Meu painel" };

export default async function LawyerPage() {
  const profile = await requireRole("lawyer");
  const today = todayInSaoPaulo();
  const [contracts, closings, transfers, notifications, goals] = await Promise.all([
    loadLawyerContracts(profile.id), loadClosings(profile.id), loadLawyerTransfers(profile.id),
    loadNotifications(profile.id), loadMonthlyContractGoal(profile.id, today.slice(0, 7)),
  ]);
  const data = buildLawyerOverview(contracts, closings, transfers, notifications, today);
  return <DashboardShell profile={profile} commandCenter={{ unreadCount: data.unreadCount,
    contracts: contracts.map((contract) => ({ id: contract.id, clientName: contractClientLabel(contract), service: contract.service_name ?? null })) }}>
    <LawyerOverview data={data} fullName={profile.full_name} goal={goals.goal} goalsAvailable={goals.available} />
  </DashboardShell>;
}
