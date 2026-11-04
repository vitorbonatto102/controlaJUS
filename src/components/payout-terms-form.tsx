"use client";
import { useActionState, useState } from "react";
import { savePayoutTerms } from "@/app/fechamentos/payout-actions";
import { emptyActionState } from "@/lib/action-state";
import { formatDateBR } from "@/lib/formatters";
import { PERCENTAGES } from "@/lib/contracts/validation";
export function PayoutTermsForm({ contractId, origin, commercial, recipientName, day, start }: { contractId: string; origin: string; commercial: number; recipientName: string | null; day: number; start: string | null }) {
  const [state, action, busy] = useActionState(savePayoutTerms, emptyActionState);
  const [reserve, setReserve] = useState(commercial);
  return <details className="operation-details"><summary>Revisar comercial e datas de repasse</summary>
    <form action={action} className="operation-form"><input type="hidden" name="contract" value={contractId} />
      <label>Reserva comercial<select name="commercial" value={reserve} onChange={event => setReserve(Number(event.target.value))}><option value="0">Sem reserva comercial</option>
        {origin === "Tráfego HP" && PERCENTAGES.map(percentage => <option key={percentage} value={percentage}>{percentage}%</option>)}</select></label>
      {origin === "Tráfego HP" && <p>A alteração recalcula valores e gera ajustes auditados nos meses já fechados.</p>}
      {reserve > 0 && <label>Quem receberá a comissão do comercial?<input name="commercialRecipientName" defaultValue={recipientName ?? ""}
        minLength={2} maxLength={160} required placeholder="Nome do beneficiário comercial" /></label>}
      {reserve > 0 && <p>O nome é preservado nos novos fechamentos. Pagamentos comerciais já registrados mantêm a identificação histórica.</p>}
      <label>Dia do repasse no mês seguinte<input name="day" type="number" min="1" max="31" defaultValue={day} required /></label>
      <label>Primeiro repasse a partir de<input name="start" placeholder="DD/MM/AAAA" defaultValue={start ? formatDateBR(start) : ""} /></label>
      <label>Motivo da revisão<textarea name="reason" required minLength={5} maxLength={1000} /></label>
      <p>Para rever a data de um fechamento já apurado, use “Revisar data prevista” na agenda daquele mês.</p>
      <button className="secondary-button" disabled={busy}>{busy ? "Salvando…" : "Salvar condições e notificar"}</button>
      {state.error && <p role="alert" className="form-error-box">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
    </form>
  </details>;
}
