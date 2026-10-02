"use client";

import { useActionState, useState } from "react";
import { addCollectionNote, registerPayment, revisePayment } from "@/app/secretaria/actions";
import { emptyActionState } from "@/lib/action-state";
import { noteTypeLabels, type OperationalContract } from "@/lib/secretary/view";

function ActionFeedback({ error, success }: { error: string | null; success: string | null }) {
  return <>{error && <p className="form-error-box" role="alert">{error}</p>}
    {success && <p className="success-box" role="status">{success}</p>}</>;
}

export function PaymentForm({ clientId, installmentId }: { clientId: string; installmentId: string }) {
  const [state, action, pending] = useActionState(registerPayment, emptyActionState);
  return <details className="operation-details"><summary>Registrar pagamento</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="installment_id" value={installmentId} />
      <label>Valor efetivamente recebido (R$)<input name="amount_paid" inputMode="decimal" placeholder="1.080,00" required /></label>
      <label>Data do pagamento<input name="payment_date" type="date" required /></label>
      <label>Observação (opcional)<textarea name="observation" maxLength={1000} rows={2} /></label>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Registrando…" : "Confirmar pagamento"}</button>
      <ActionFeedback error={state.error} success={state.success} />
    </form>
  </details>;
}

export function NoteForm({ clientId, contracts }: { clientId: string; contracts: OperationalContract[] }) {
  const [state, action, pending] = useActionState(addCollectionNote, emptyActionState);
  const [contractId, setContractId] = useState("");
  const installments = contracts.find((contract) => contract.id === contractId)?.installments ?? [];
  return <form action={action} className="operation-form note-form">
    <input type="hidden" name="client_id" value={clientId} />
    <label>Tipo<select name="note_type" required>{Object.entries(noteTypeLabels).map(([key, label]) =>
      <option key={key} value={key}>{label}</option>)}</select></label>
    <label>Contrato<select name="contract_id" value={contractId} onChange={(e) => setContractId(e.target.value)}>
      <option value="">Anotação geral do cliente</option>{contracts.map((contract) =>
        <option key={contract.id} value={contract.id}>{contract.origin} · {contract.lawyer_name}</option>)}</select></label>
    <label>Parcela<select name="installment_id" key={contractId} disabled={!contractId}>
      <option value="">Contrato inteiro</option>{installments.map((item) =>
        <option key={item.id} value={item.id}>Parcela {item.installment_number}</option>)}</select></label>
    <label className="operation-wide">Anotação<textarea name="content" minLength={2} maxLength={3000} rows={4} required /></label>
    <button className="primary-button" disabled={pending} type="submit">{pending ? "Salvando…" : "Adicionar anotação"}</button>
    <ActionFeedback error={state.error} success={state.success} />
  </form>;
}

export function PaymentCorrectionForm({ clientId, paymentId, amount, date }: {
  clientId: string; paymentId: string; amount: string; date: string;
}) {
  const [state, action, pending] = useActionState(revisePayment, emptyActionState);
  const [mode, setMode] = useState("replace");
  return <details className="operation-details"><summary>Corrigir ou estornar</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="payment_id" value={paymentId} />
      <label>Ação<select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="replace">Corrigir lançamento</option><option value="void">Estornar pagamento</option>
      </select></label>
      {mode === "replace" && <><label>Novo valor (R$)<input name="amount_paid" defaultValue={amount} inputMode="decimal" required /></label>
        <label>Nova data<input name="payment_date" type="date" defaultValue={date} required /></label></>}
      <label>Motivo da correção<textarea name="reason" minLength={5} maxLength={1000} rows={2} required /></label>
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Salvando…" :
        mode === "void" ? "Confirmar estorno" : "Salvar correção"}</button>
      <ActionFeedback error={state.error} success={state.success} />
    </form>
  </details>;
}
