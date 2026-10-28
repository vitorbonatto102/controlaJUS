export type MonthlyContractGoal = {
  reference_month: string;
  target_contract_count: number;
  updated_at: string;
};

export function contractGoalProgress(achieved: number, target: number | null) {
  // Never announce a milestone before its actual threshold (e.g. 99/100 is not 100%).
  const percentage = target && target > 0 ? Math.floor(achieved / target * 100) : 0;
  return { percentage, barPercentage: Math.min(percentage, 100),
    remaining: target ? Math.max(0, target - achieved) : null,
    reached: target !== null && achieved >= target };
}
