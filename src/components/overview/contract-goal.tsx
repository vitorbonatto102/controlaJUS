"use client";

import { useActionState, useState } from "react";
import { saveContractGoal } from "@/app/advogada/metas/actions";
import { emptyActionState } from "@/lib/action-state";
import { contractGoalProgress, type MonthlyContractGoal } from "@/lib/dashboard/goals";
import { OverviewIcon } from "./overview-icon";
import styles from "./overview.module.css";

export function ContractGoal({ goal, available, achieved, month }: {
  goal: MonthlyContractGoal | null; available: boolean; achieved: number; month: string;
}) {
  const [editing, setEditing] = useState(!goal);
  const [state, action, pending] = useActionState(saveContractGoal, emptyActionState);
  const progress = contractGoalProgress(achieved, goal?.target_contract_count ?? null);
  return <section className={styles.goal} id="meta-mensal" aria-labelledby="goal-title">
    <div className={styles.goalHeading}><span><OverviewIcon name="target" size={17} /> <h2 id="goal-title">Minha meta de contratos</h2></span>
      {available && goal && <button type="button" onClick={() => setEditing(!editing)} aria-label="Editar meta mensal"
        aria-expanded={editing} className={styles.iconButton}><OverviewIcon name="edit" size={17} /></button>}</div>
    {goal ? <>
      <div className={styles.goalNumbers}><strong>{achieved}<span> / {goal.target_contract_count}</span></strong>
        <span>{progress.percentage}% da meta</span></div>
      <p>contratos fechados neste mês</p>
      <div className={styles.progressTrack} role="progressbar" aria-label="Progresso da meta de contratos"
        aria-valuemin={0} aria-valuemax={goal.target_contract_count} aria-valuenow={Math.min(achieved, goal.target_contract_count)}
        aria-valuetext={`${achieved} de ${goal.target_contract_count} contratos; ${progress.percentage}% da meta`}>
        <span style={{ width: `${progress.barPercentage}%` }} /></div>
      <small>{progress.reached ? "Meta alcançada. Cada novo contrato amplia sua conquista." :
        `${progress.remaining === 1 ? "Falta" : "Faltam"} ${progress.remaining} ${progress.remaining === 1 ? "contrato" : "contratos"} para chegar lá.`}</small>
    </> : <><div className={styles.goalNumbers}><strong>{achieved} <span>{achieved === 1 ? "contrato" : "contratos"}</span></strong></div>
      <p>fechados no mês. Qual será seu próximo objetivo?</p></>}
    {available && editing && <form action={action} className={styles.goalForm}>
      <input name="month" type="hidden" value={month} />
      <label htmlFor="contract-goal">Meta de contratos no mês</label><div>
        <input id="contract-goal" name="target" type="number" min={1} max={10000} step={1} required
          inputMode="numeric" defaultValue={goal?.target_contract_count} placeholder="Ex.: 10" />
        <button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar meta"}</button>
      </div>
      {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </form>}
    {!available && <small>A definição de metas estará disponível após a configuração pelo administrador.</small>}
  </section>;
}
