import { useActionState, useState } from "react";
import { correctCommissionRetention } from "@/app/gestor/actions";
import { emptyActionState } from "@/lib/action-state";
import { commissionModeLabels, type CommissionMode } from "@/lib/contracts/commission-retention";
import { formatBRL } from "@/lib/formatters";

export function ManagerCommissionTermsForm({ contractId, mode, limit, totalKnown }: {
  contractId: string; mode: CommissionMode; limit: number | null; totalKnown: boolean;
}) {
  const [selected, setSelected] = useState(mode);
  const [state, action, pending] = useActionState(correctCommissionRetention, emptyActionState);
  return <details className="operation-details"><summary>Corrigir forma de comissão</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="contract_id" value={contractId} />
      <p>Atual: <strong>{commissionModeLabels[mode]}{limit !== null && ` · Limite: ${formatBRL(limit)}`}</strong></p>
      <label>Forma de comissão<select name="commission_mode" value={selected} onChange={(event) => setSelected(event.target.value as CommissionMode)}>
        {Object.entries(commissionModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {selected === "upfront" && (!totalKnown ? <label>Limite total da comissão (R$)
        <input name="commission_limit" inputMode="decimal" defaultValue={limit === null ? "" : formatBRL(limit)} required /></label> :
        <p>O limite será calculado pelo valor total do contrato × o percentual da advogada.</p>)}
      <label>Motivo da correção<textarea name="reason" minLength={5} maxLength={1000} required /></label>
      <p>A correção recalcula as comissões atuais e registra ajustes nos fechamentos afetados.</p>
      <button className="secondary-button" type="submit" disabled={pending}>{pending ? "Corrigindo…" : "Confirmar correção"}</button>
      {state.error && <p className="form-error-box" role="alert">{state.error}</p>}
      {state.success && <p className="success-box" role="status">{state.success}</p>}
    </form>
  </details>;
}
