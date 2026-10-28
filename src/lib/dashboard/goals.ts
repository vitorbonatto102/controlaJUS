export type MonthlyContractGoal = {
  reference_month: string;
  target_contract_count: number;
  updated_at: string;
};

export function contractGoalProgress(achieved: number, target: number | null) {
  const percentage = target && target > 0 ? Math.round(achieved / target * 100) : 0;
  return { percentage, barPercentage: Math.min(percentage, 100),
    remaining: target ? Math.max(0, target - achieved) : null,
    reached: target !== null && achieved >= target };
}
