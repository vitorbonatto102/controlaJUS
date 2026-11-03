import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { GoalsView } from "@/components/goals/goals-view";
import { requireActiveProfile } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { loadGoalSummary } from "@/lib/goals/data";
import { validGoalMonth, type GoalScope } from "@/lib/goals/model";
import styles from "@/components/goals/goals.module.css";

export const metadata: Metadata = { title: "Suas metas" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ mes?: string; escopo?: string }> }) {
  const profile = await requireActiveProfile();
  const query = await searchParams;
  if (profile.role === "manager") redirect(`/gestor/metas${query.mes ? `?mes=${encodeURIComponent(query.mes)}` : ""}`);
  if (profile.role !== "lawyer") redirect("/app");
  const today = todayInSaoPaulo();
  const scope: GoalScope = "individual";
  if (query.mes && !validGoalMonth(query.mes, today.slice(0, 7))) redirect(`/metas?escopo=${scope}`);
  const month = query.mes ?? today.slice(0, 7);
  const summary = await loadGoalSummary(scope, month);
  return <DashboardShell profile={profile}>{summary ? <GoalsView summary={summary} today={today}
    canEdit canViewIndividual canViewOffice={false}
    identity={`${profile.office_id}:${profile.id}`} /> :
    <section className={styles.setup}><h1>Suas metas</h1><p>O acompanhamento de contratações está sendo preparado.</p>
      <p>A administração precisa aplicar a atualização das metas pela data de contratação.</p></section>}
  </DashboardShell>;
}
