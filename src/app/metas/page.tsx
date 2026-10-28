import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { GoalsView } from "@/components/goals/goals-view";
import { requireActiveProfile } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { loadGoalSummary, loadUnconfirmedContracts } from "@/lib/goals/data";
import { validGoalMonth, type GoalScope } from "@/lib/goals/model";
import styles from "@/components/goals/goals.module.css";

export const metadata: Metadata = { title: "Suas metas" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ mes?: string; escopo?: string }> }) {
  const profile = await requireActiveProfile();
  const canViewIndividual = profile.role === "lawyer";
  const canViewOffice = profile.is_office_admin || profile.role === "manager";
  if (!canViewIndividual && !canViewOffice) redirect("/app");
  const query = await searchParams;
  const today = todayInSaoPaulo();
  const scope: GoalScope = query.escopo === "office" || !canViewIndividual ? "office" : "individual";
  if (scope === "office" && !canViewOffice) redirect("/metas");
  if (query.mes && !validGoalMonth(query.mes, today.slice(0, 7))) redirect(`/metas?escopo=${scope}`);
  const month = query.mes ?? today.slice(0, 7);
  const summary = await loadGoalSummary(scope, month);
  const pending = summary && scope === "individual" && summary.pending_count > 0 ? await loadUnconfirmedContracts(profile.id) : [];
  return <DashboardShell profile={profile}>{summary ? <GoalsView summary={summary} today={today}
    canEdit={scope === "individual" || profile.is_office_admin} canViewIndividual={canViewIndividual} canViewOffice={canViewOffice}
    identity={`${profile.office_id}:${profile.id}`} pending={pending} /> :
    <section className={styles.setup}><h1>Suas metas</h1><p>O acompanhamento de contratações está sendo preparado.</p>
      <p>A administração precisa concluir a atualização do módulo antes de configurar metas e confirmar fechamentos.</p></section>}
  </DashboardShell>;
}
