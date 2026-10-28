import Link from "next/link";
import { contractGoalProgress, type MonthlyContractGoal } from "@/lib/dashboard/goals";
import { OverviewIcon } from "./overview-icon";
import styles from "./overview.module.css";

export function ContractGoal({ goal, available, achieved }: {
  goal: MonthlyContractGoal | null; available: boolean; achieved: number; month: string;
}) {
  const progress = contractGoalProgress(achieved, goal?.target_contract_count ?? null);
  return <section className={styles.goal} id="meta-mensal" aria-labelledby="goal-title">
    <div className={styles.goalHeading}><span><OverviewIcon name="target" size={17} /><h2 id="goal-title">Meta de contratos</h2></span></div>
    <div className={styles.goalNumbers}><strong>{achieved}<span>{goal ? ` / ${goal.target_contract_count}` : " confirmados"}</span></strong>
      {goal && <span>{progress.percentage}% da meta</span>}</div>
    {goal && <div className={styles.progressTrack} role="progressbar" aria-label="Progresso da meta mensal"
      aria-valuemin={0} aria-valuemax={goal.target_contract_count} aria-valuenow={Math.min(achieved, goal.target_contract_count)}>
      <span style={{width:`${progress.barPercentage}%`}} /></div>}
    <small>{!available ? "A configuração das metas está sendo concluída." : !goal ? "Defina seu objetivo para este mês." :
      progress.reached ? "Meta do mês concluída." : `${progress.remaining===1?"Falta":"Faltam"} ${progress.remaining} ${progress.remaining===1?"contrato":"contratos"} para sua meta.`}</small>
    <Link href="/metas" className={styles.goalLink}>Ver minhas metas <OverviewIcon name="arrow" size={15}/></Link>
  </section>;
}
