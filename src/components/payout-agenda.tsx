"use client";
import { useActionState, useState } from "react";
import { recordScheduledTransfer, reverseCommercialTransfer } from "@/app/fechamentos/payout-actions";
import { emptyActionState } from "@/lib/action-state";
import type { PayoutAgenda, PayoutItem } from "@/lib/finance/payouts";
import { formatBRL, formatDateBR } from "@/lib/formatters";

function ReverseCommercial({ id, closing }: { id: string; closing: string }) {
  const [state, action, busy] = useActionState(reverseCommercialTransfer, emptyActionState);
  return <details><summary>Estornar</summary><form action={action} className="operation-form"><input name="id" type="hidden" value={id} /><input name="closing" type="hidden" value={closing} />
    <label>Motivo<textarea name="reason" required minLength={5} maxLength={1000} /></label><button className="secondary-button" disabled={busy}>Confirmar estorno</button>
    {state.error && <p role="alert">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}</form></details>;
}
function TransferEntry({ agenda, item }: { agenda: PayoutAgenda; item: PayoutItem }) {
  const [state, action, busy] = useActionState(recordScheduledTransfer, emptyActionState);
  const [existing, setExisting] = useState("");
  return <details className="operation-details"><summary>Registrar / vincular repasse</summary><form action={action} className="operation-form">
    <input type="hidden" name="closing" value={agenda.closing_id} /><input type="hidden" name="contract" value={item.contract_id} /><input type="hidden" name="recipient" value={item.recipient} />
    {item.recipient === "lawyer" && agenda.unallocated_transfers.length > 0 && <label>Repasse já registrado<select name="existing" value={existing} onChange={e => setExisting(e.target.value)} required>
      <option value="">Selecione o pagamento existente</option>{agenda.unallocated_transfers.map(t => <option key={t.id} value={t.id}>{formatDateBR(t.payment_date)} · {formatBRL(t.amount)} sem vínculo</option>)}</select></label>}
    <label>Valor {existing ? "a vincular" : "efetivamente pago"}<input name="amount" inputMode="decimal" defaultValue={formatBRL(item.balance)} required /></label>
    {!existing && <label>Data real do pagamento<input name="date" placeholder="DD/MM/AAAA" inputMode="numeric" maxLength={10} required /></label>}
    <label>{item.recipient === "commercial" ? "Beneficiário comercial / observação" : "Observação / motivo do vínculo"}<textarea name="notes" defaultValue={item.recipient === "commercial" ? item.recipient_name ?? "" : ""} maxLength={1000} minLength={existing ? 5 : undefined} required={!!existing || item.recipient === "commercial"} /></label>
    <button disabled={busy || (item.recipient === "lawyer" && agenda.unallocated_transfers.length > 0 && !existing)} className="primary-button">{busy ? "Salvando…" : existing ? "Vincular pagamento existente" : "Confirmar repasse realizado"}</button>
    {state.error && <p className="form-error-box" role="alert">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
  </form></details>;
}
export function PayoutAgendaView({ agenda, manager }: { agenda: PayoutAgenda; manager: boolean }) {
  return <section className="workspace-panel"><h2>Agenda de repasses</h2>
    <p>Destinação dos recebimentos do mês. Cada repasse pode ser parcial; só pagamentos efetivamente registrados aparecem como pagos.</p>
    {agenda.unallocated_transfers.length > 0 && <p className="adjustment-notice">Há {formatBRL(agenda.unallocated_transfers.reduce((sum,t) => sum + Number(t.amount),0))} em repasses já registrados, aguardando vínculo aos contratos. {manager ? "Vincule-os abaixo antes de lançar novos repasses à advogada." : "O gestor fará a identificação desses valores. O total já recebido do escritório permanece no fechamento."}</p>}
    <div className="table-scroll"><table className="data-table" style={{minWidth:800}}><thead><tr><th>Contrato</th><th>Beneficiário</th><th>Valor</th><th>Pago identificado</th><th>Saldo</th>{manager && <th>Ações</th>}</tr></thead>
      <tbody>{agenda.items.map(item => <tr key={`${item.contract_id}:${item.recipient}`}>
        <td>{item.client_name}<small style={{display:"block"}}>{item.service_name || item.origin} · {item.origin}</small></td><td>{item.recipient === "lawyer" ? "Advogada" : <>Terceiro/comercial<small style={{display:"block"}}>{item.recipient_name || "Beneficiário ainda não informado"}</small></>}</td>
        <td>{formatBRL(item.amount)}</td><td>{formatBRL(item.paid)}</td><td>{formatBRL(item.balance)}{item.overpaid > 0 && <small style={{display:"block"}}>Excesso a regularizar: {formatBRL(item.overpaid)}</small>}</td>
        {manager && <td>{item.balance > 0 && <TransferEntry agenda={agenda} item={item} />}</td>}
      </tr>)}</tbody></table></div>
    {!agenda.items.length && <p>Nenhum valor a programar neste fechamento.</p>}
    {manager && !!agenda.commercial_transfers?.length && <details><summary>Histórico de repasses a terceiros</summary><ul className="audit-list">
      {agenda.commercial_transfers.map(t => <li key={t.id}>{formatDateBR(t.payment_date)} · {formatBRL(t.amount)} · {t.notes || "Comercial"}
        {t.reversed_at ? <small> · Estornado: {t.reversal_reason}</small> : <ReverseCommercial id={t.id} closing={agenda.closing_id} />}</li>)}</ul></details>}
  </section>;
}

/** Somente concilia pagamentos antigos: não cria a rotina de confirmar novos repasses. */
export function LegacyPayoutLinks({agenda}:{agenda:PayoutAgenda}) {
  if (!agenda.unallocated_transfers.length) return null;
  return <details className="workspace-panel"><summary>Conferir vínculos de repasses anteriores</summary>
    <p>Existem pagamentos antigos já registrados sem identificação dos contratos. Vincule esses valores para liberar a confirmação pela advogada, sem lançar o pagamento novamente.</p>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Contrato</th><th>Saldo a identificar</th><th>Vínculo</th></tr></thead>
      <tbody>{agenda.items.filter(item=>item.recipient==="lawyer"&&item.balance>0).map(item=><tr key={item.contract_id}>
        <td>{item.client_name} · {item.origin}</td><td>{formatBRL(item.balance)}</td><td><TransferEntry agenda={agenda} item={item}/></td>
      </tr>)}</tbody></table></div>
  </details>;
}
