"use client";

import { useActionState, useState } from "react";
import { saveContractGoal } from "@/app/advogada/metas/actions";
import { saveOfficeGoal } from "@/app/metas/actions";
import { emptyActionState } from "@/lib/action-state";
import type { GoalScope } from "@/lib/goals/model";
import styles from "./goals.module.css";

export function GoalEditor({ month, target, scope }: { month: string; target: number | null; scope: GoalScope }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(scope === "office" ? saveOfficeGoal : saveContractGoal, emptyActionState);
  return <div className={styles.editor} id="configurar-meta">
    <button type="button" className={styles.editButton} aria-expanded={editing} onClick={() => setEditing(!editing)}>
      {editing ? "Fechar edição" : target ? "Editar meta" : "Criar uma meta"}</button>
    {editing && <form action={action}><input type="hidden" name="month" value={month} />
      <label htmlFor="goal-target">Quantidade de contratos no mês</label><div className={styles.editFields}>
        <input id="goal-target" name="target" type="number" min={1} max={10000} step={1} inputMode="numeric" required
          defaultValue={target ?? undefined} placeholder="Quantidade desejada" />
        <button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar meta"}</button></div>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </form>}
  </div>;
}
