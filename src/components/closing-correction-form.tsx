"use client";
import {useActionState,useState} from "react";
import {correctClosedValues} from "@/app/fechamentos/[id]/actions";
import {emptyActionState} from "@/lib/action-state";

export function ClosingCorrectionForm({closing,payments,installments}:{closing:string;
  payments:{id:string;label:string}[];installments:{id:string;label:string}[]}) {
  const [mode,setMode]=useState("replace");
  const [state,action,pending]=useActionState(correctClosedValues,emptyActionState);
  return <details className="workspace-panel"><summary>Corrigir valores</summary>
    <p>A composição original será preservada. Cada correção exige uma explicação e avisa a outra parte. O repasse continua sendo registrado pelo gestor.</p>
    <form action={action} className="operation-form">
      <input type="hidden" name="closing" value={closing}/>
      <label>O que deseja corrigir?<select name="mode" value={mode} onChange={e=>setMode(e.target.value)}>
        <option value="replace">Corrigir valor ou data de um recebimento</option><option value="add">Incluir recebimento que faltou</option>
        <option value="void">Estornar recebimento incorreto</option></select></label>
      {mode==="add"?<label>Parcela<select name="installment" required defaultValue=""><option value="" disabled>Selecione a parcela</option>
        {installments.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>:
        <label>Recebimento<select name="payment" required defaultValue=""><option value="" disabled>Selecione o recebimento</option>
          {payments.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
      {mode!=="void"&&<><label>Valor efetivamente recebido (R$)<input name="amount" inputMode="decimal" placeholder="0,00" required/></label>
        <label>Data real do pagamento neste mês<input name="date" inputMode="numeric" placeholder="DD/MM/AAAA" maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" required/></label></>}
      <label>Por que está corrigindo?<textarea name="reason" minLength={5} maxLength={1000} required/></label>
      <button className="primary-button" disabled={pending}>{pending?"Salvando…":"Salvar correção e notificar"}</button>
      {state.error&&<p role="alert" className="form-error-box">{state.error}</p>}{state.success&&<p role="status" className="success-box">{state.success}</p>}
    </form></details>;
}
