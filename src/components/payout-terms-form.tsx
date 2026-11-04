"use client";
import { useActionState, useState } from "react";
import { savePayoutTerms } from "@/app/fechamentos/payout-actions";
import { emptyActionState } from "@/lib/action-state";
import { formatBRL } from "@/lib/formatters";
import { PERCENTAGES } from "@/lib/contracts/validation";
import type {CommissionMode} from "@/lib/contracts/commission-retention";
export function PayoutTermsForm({ contractId, origin, commercial, recipientName, mode, distribution, thirdLimit }: { contractId: string; origin: string; commercial: number; recipientName: string | null; mode:CommissionMode; distribution:"lawyer_only"|"shared"|null;thirdLimit:number|null }) {
  const [state, action, busy] = useActionState(savePayoutTerms, emptyActionState);
  const [reserve, setReserve] = useState(commercial);
  const [share,setShare]=useState(distribution ?? (commercial>0?"shared":"lawyer_only"));
  return <details className="operation-details"><summary>Revisar destinação ao terceiro/comercial</summary>
    <form action={action} className="operation-form"><input type="hidden" name="contract" value={contractId} />
      <input type="hidden" name="mode" value={mode}/>
      {mode === "upfront" ? <><input type="hidden" name="commercial" value={share === "lawyer_only" ? 0 : reserve}/>
        <label>Destinação das primeiras parcelas<select name="distribution" value={share} onChange={event=>setShare(event.target.value as "shared"|"lawyer_only")}>
          <option value="lawyer_only">Somente a participação da advogada</option><option value="shared">Advogada e terceiro/comercial</option></select></label>
        {share === "shared" && <label>Valor total a quitar ao terceiro/comercial (R$)<input name="thirdLimit" defaultValue={thirdLimit === null ? "" : formatBRL(thirdLimit)} inputMode="decimal" placeholder="0,00" required/></label>}
      </> : <>
      <label>Reserva comercial<select name="commercial" value={reserve} onChange={event => setReserve(Number(event.target.value))}><option value="0">Sem reserva comercial</option>
        {origin === "Tráfego HP" && PERCENTAGES.map(percentage => <option key={percentage} value={percentage}>{percentage}%</option>)}</select></label>
      </>}
      <p>A alteração recalcula valores e gera ajustes auditados nos meses já fechados.</p>
      {(mode === "upfront" ? share === "shared" : reserve > 0) && <label>Nome do terceiro/comercial<input name="commercialRecipientName" defaultValue={recipientName ?? ""}
        minLength={2} maxLength={160} required placeholder="Nome do beneficiário comercial" /></label>}
      <label>Motivo da revisão<textarea name="reason" required minLength={5} maxLength={1000} /></label>
      <button className="secondary-button" disabled={busy}>{busy ? "Salvando…" : "Salvar condições e notificar"}</button>
      {state.error && <p role="alert" className="form-error-box">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
    </form>
  </details>;
}
