import { shiftMonth } from "@/lib/contracts/wallet";
import { contractGoalProgress } from "@/lib/dashboard/goals";

export type GoalScope = "individual" | "office";
export type GoalMonth = { month: string; count: number; target: number | null; has_history: boolean };
export type GoalSummary = {
  month: string; scope: GoalScope; as_of: string; count: number;
  previous_count: number; previous_until: string; comparison_available: boolean;
  best_previous_count: number | null; pending_count: number; history: GoalMonth[];
  goal_updated_at: string | null;
};

export function validGoalMonth(value: string, currentMonth: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2000-01" && value <= currentMonth;
}

export function goalEvolution(summary: GoalSummary, today: string) {
  const target = summary.history.find((item) => item.month === summary.month)?.target ?? null;
  const progress = contractGoalProgress(summary.count, target);
  const current = summary.month === today.slice(0, 7);
  const [year, month] = summary.month.split("-").map(Number);
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const elapsedDays = current ? Number(today.slice(8)) : totalDays;
  const daysRemaining = current ? Math.max(0, totalDays - elapsedDays) : 0;
  const previousThree = [-3, -2, -1].map((offset) => summary.history.find((item) => item.month === shiftMonth(summary.month, offset)));
  const average = previousThree.every((item) => item?.has_history)
    ? previousThree.reduce((sum, item) => sum + item!.count, 0) / 3 : null;
  return { target, ...progress, current, daysRemaining, average,
    requiredPerDay: daysRemaining > 0 && progress.remaining !== null ? progress.remaining / daysRemaining : null,
    projection: current && summary.count > 0 ? Math.floor(summary.count / elapsedDays * totalDays) : null,
    difference: summary.comparison_available ? summary.count - summary.previous_count : null,
    newRecord: summary.best_previous_count !== null && summary.count > summary.best_previous_count,
    milestone: [25, 50, 75, 100].filter((value) => progress.percentage >= value).at(-1) ?? 0,
  };
}
