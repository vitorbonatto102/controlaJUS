"use client";
import {useActionState,useState} from "react";
import {issuePayoutReport,confirmPayoutReceipt,reverseOwnReceipt} from "@/app/repasses/actions";
import {emptyActionState} from "@/lib/action-state";
import {formatBRL} from "@/lib/formatters";

export function IssuePayoutReport({closing,origins,request}:{closing:string;origins:string[];request:string}){
  const [state,action,busy]=useActionState(issuePayoutReport,emptyActionState);
  return <form action={action}><input type="hidden" name="closing" value={closing}/><input type="hidden" name="request" value={request}/>
    {origins.map(origin=><input type="hidden" name="origem" value={origin} key={origin}/>)}
    <button className="primary-button" disabled={busy}>{busy?"Emitindo…":"Emitir relatório para repasse"}</button>
    <p>Use as origens selecionadas acima. Depois de receber o pagamento, confirme-o no relatório emitido.</p>
    {state.error&&<p className="form-error-box" role="alert">{state.error}</p>}</form>;
}
export function ConfirmPayoutReceipt({report,request,available}:{report:string;request:string;available:number}){
  const [state,action,busy]=useActionState(confirmPayoutReceipt,emptyActionState);
  const [date,setDate]=useState("");
  return <section className="workspace-panel"><h2>Confirmar meu recebimento</h2><p>Registre somente o que já entrou na sua conta. Você pode confirmar uma parte agora e o restante depois.</p>
    <form action={action} className="operation-form"><input type="hidden" name="report" value={report}/><input type="hidden" name="request" value={request}/>
      <label>Valor que recebi (R$)<input name="amount" inputMode="decimal" defaultValue={formatBRL(available/100)} required/></label>
      <label>Data real do recebimento<input name="date" inputMode="numeric" placeholder="DD/MM/AAAA" value={date}
        onChange={event=>setDate(event.target.value.replace(/\D/g,"").slice(0,8).replace(/^(\d{2})(\d)/,"$1/$2").replace(/^(\d{2}\/\d{2})(\d)/,"$1/$2"))} maxLength={10} required/></label>
      <label>Observação (opcional)<textarea name="notes" maxLength={1000}/></label>
      <label className="checkbox-label operation-wide"><input type="checkbox" name="confirm" value="yes" required/>Confirmo que este valor já entrou na minha conta.</label>
      <p>A confirmação se refere à sua participação. Valores do terceiro/comercial continuam demonstrados separadamente.</p>
      <button className="primary-button" disabled={busy}>{busy?"Confirmando…":"Confirmar recebimento"}</button>
      {state.error&&<p className="form-error-box" role="alert">{state.error}</p>}
    </form></section>;
}
export function ReverseOwnReceipt({report,transfer}:{report:string;transfer:string}){
  const [state,action,busy]=useActionState(reverseOwnReceipt,emptyActionState);
  return <details className="operation-details"><summary>Corrigir confirmação</summary><form action={action} className="operation-form">
    <input type="hidden" name="report" value={report}/><input type="hidden" name="transfer" value={transfer}/>
    <p>A confirmação será desfeita com histórico e aviso ao gestor. Depois, você poderá registrar o valor e a data corretos.</p>
    <label>Motivo da correção<textarea name="reason" minLength={5} maxLength={1000} required/></label>
    <button className="secondary-button" disabled={busy}>{busy?"Salvando…":"Desfazer confirmação"}</button>
    {state.error&&<p className="form-error-box" role="alert">{state.error}</p>}</form></details>;
}
