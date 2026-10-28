"use client";

import { useActionState, useState } from "react";
import { updateEngagement } from "@/app/advogada/contratos/actions";
import { emptyActionState } from "@/lib/action-state";
import { engagementLabels, type ContractEngagement, type EngagementStatus } from "@/lib/contracts/engagement";
import { formatDateBR } from "@/lib/formatters";
import styles from "../goals/goals.module.css";

export function EngagementForm({ contract }: { contract: ContractEngagement }) {
  const [status, setStatus] = useState<EngagementStatus>(contract.engagement_status ?? "unconfirmed");
  const [date, setDate] = useState(contract.closed_on ? formatDateBR(contract.closed_on) : "");
  const [state, action, pending] = useActionState(updateEngagement, emptyActionState);
  return <section className={styles.confirmation} id={`confirmacao-contratacao-${contract.id}`} aria-label="Confirmação da contratação">
    <h2>Confirmação da contratação</h2>
    {contract.engagement_status === undefined ? <p>A confirmação para metas aguarda a atualização pelo administrador.</p> : <>
      <p><strong>{engagementLabels[contract.engagement_status]}</strong>{contract.closed_on && ` · ${formatDateBR(contract.closed_on)}`}.
        Somente contratações efetivamente confirmadas ou assinadas contam nas metas, pela data de fechamento.</p>
      <details><summary>Atualizar situação da contratação</summary><form action={action} className={styles.confirmationForm}>
        <input type="hidden" name="contract_id" value={contract.id} /><input type="hidden" name="version" value={contract.updated_at} />
        <label>Situação<select name="status" value={status} onChange={(event) => setStatus(event.target.value as EngagementStatus)}>
          {Object.entries(engagementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        {status === "confirmed" && <><label>Data efetiva de fechamento<input name="closed_on" placeholder="DD/MM/AAAA" inputMode="numeric"
          required maxLength={10} value={date} onChange={(event) => setDate(event.target.value.replace(/\D/g, "").slice(0, 8)
            .replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2"))} /></label>
          <label className={styles.checkLine}><input type="checkbox" name="confirmed" value="yes" required />
            Confirmo que a contratação foi efetivamente confirmada ou assinada.</label></>}
        <label className={styles.wide}>Anotação da alteração<input name="reason" required minLength={5} maxLength={1000}
          placeholder="Informe o contexto da confirmação ou correção" /></label>
        <small className={styles.wide}>Cancelar ou desfazer a confirmação atualiza as metas. Os lançamentos financeiros permanecem preservados.</small>
        <button type="submit" className="secondary-button" disabled={pending}>{pending ? "Salvando…" : "Salvar situação"}</button>
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        {state.success && <p role="status">{state.success}</p>}
      </form></details>
    </>}
  </section>;
}
