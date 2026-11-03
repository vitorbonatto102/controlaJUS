import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { TeamGoalsView } from "@/components/goals/team-goals-view";
import { requireRole } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { loadTeamGoals } from "@/lib/goals/data";
import { validGoalMonth } from "@/lib/goals/model";
import styles from "@/components/goals/goals.module.css";

export const metadata: Metadata = { title: "Metas da equipe" };
export default async function TeamGoalsPage({ searchParams }: { searchParams: Promise<{ mes?: string; advogada?: string }> }) {
  const profile = await requireRole("manager"), today = todayInSaoPaulo();
  const query = await searchParams;
  if (query.mes && !validGoalMonth(query.mes, today.slice(0, 7))) redirect("/gestor/metas");
  const summary = await loadTeamGoals(query.mes ?? today.slice(0, 7));
  return <DashboardShell profile={profile}>{summary ? <TeamGoalsView summary={summary} today={today} lawyerId={query.advogada ?? ""} /> :
    <section className={styles.setup}><h1>Metas da equipe</h1><p>O acompanhamento aguarda a atualização das metas pela data de contratação no banco.</p></section>}
  </DashboardShell>;
}
