"use client";

import { useActionState, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { saveLawyerContract } from "@/app/advogada/contratos/actions";
import { ContractDataFields, ContractReview, InternalFields } from "@/components/new-contract-form";
import { emptyActionState } from "@/lib/action-state";
import { contractToForm, prepareContractEdit } from "@/lib/contracts/editing";
import { prepareContract, type ContractFormValues, type ContractPreview } from "@/lib/contracts/registration";
import type { ContractRecord } from "@/lib/contracts/view";
import { hasPdfSignature, isValidPdf, ORIGINS } from "@/lib/contracts/validation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import styles from "./contract-management.module.css";

export function EditContractForm({ contract, lawyerId, financialLocked }: {
  contract: ContractRecord; lawyerId: string; financialLocked: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => contractToForm(contract));
  const [preview, setPreview] = useState<ContractPreview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(async (_previous: typeof emptyActionState, form: FormData) => {
    let path: string | null = null;
    let saved = false;
    // The PDF goes directly to private Storage, keeping Server Actions below Vercel's request limit.
    form.delete("pdf");
    try {
      if (file) {
        if (!isValidPdf(file) || !(await hasPdfSignature(file))) throw new Error("Selecione um PDF válido de até 10 MB.");
        path = `contracts/${lawyerId}/${contract.id}/${crypto.randomUUID()}.pdf`;
        const { error: uploadError } = await supabase.storage.from("contract-pdfs").upload(path, file,
          { contentType: "application/pdf", upsert: false });
        if (uploadError) throw new Error("Não foi possível enviar o PDF. Tente novamente.");
        form.set("file_path", path); form.set("file_name", file.name);
      }
      const result = await saveLawyerContract(emptyActionState, form);
      saved = !!result.success;
      if (saved) { router.push(`/advogada/contratos/${contract.id}?editado=1`); router.refresh(); }
      return result;
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Não foi possível salvar o contrato.", success: null };
    } finally {
      if (!saved && path) await supabase.storage.from("contract-pdfs").remove([path]);
    }
  }, emptyActionState);
  const set = <K extends keyof ContractFormValues>(key: K, value: ContractFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const review = () => {
    setError("");
    try {
      prepareContractEdit(values, financialLocked);
      setPreview(financialLocked ? null : prepareContract(values, { validateClient: false }));
      setReviewing(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confira os dados."); }
  };
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (selected && (!isValidPdf(selected) || selected.name.length > 255)) {
      setError("Selecione um PDF válido de até 10 MB e nome de até 255 caracteres.");
      event.target.value = ""; setFile(null); return;
    }
    setFile(selected); setError("");
  };
  return <form ref={formRef} action={action} className={`${styles.form} contract-form`}
    onSubmit={(event) => { if (!reviewing) { event.preventDefault(); review(); } }}>
    <input type="hidden" name="contract_id" value={contract.id} />
    <input type="hidden" name="version" value={contract.updated_at ?? ""} />
    <input type="hidden" name="metadata_only" value={financialLocked ? "yes" : "no"} />
    <input type="hidden" name="values" value={JSON.stringify(values)} />
    {financialLocked && <div className="success-box">Este contrato já possui histórico de pagamentos ou cobranças por parcela.
      Você pode alterar a origem, a data do contrato e o PDF. Para corrigir valores, percentuais ou parcelas, solicite a correção ao gestor.</div>}
    {(error || state.error) && <div className="form-error-box" role="alert">{error || state.error}</div>}
    {!reviewing && <fieldset disabled={pending}>{financialLocked ? <section className="form-panel"><h2>Dados do contrato</h2>
      <p className="field-hint">Contratante: {contract.client_name}. O cadastro do cliente permanece vinculado.</p>
      <div className="form-grid"><label>Origem da contratação<select value={values.origin} onChange={(event) => set("origin", event.target.value)}>
        {ORIGINS.map((origin) => <option key={origin}>{origin}</option>)}</select></label>
        <label>Data do contrato<input value={values.contractDate} placeholder="DD/MM/AAAA" maxLength={10}
          onChange={(event) => set("contractDate", event.target.value)} /></label></div></section> : <>
      <ContractDataFields values={values} set={set} note={() => null} cpfNotice="O cliente vinculado é preservado nesta edição."
        checkCpf={() => {}} readOnlyClient />
      <InternalFields values={values} set={set} note={() => null} />
    </>}</fieldset>}
    <section className="form-panel" hidden={reviewing}><h2>Documento do contrato</h2>
      <p className="field-hint">{contract.contract_file_name ? `Atual: ${contract.contract_file_name}.` : "Sem PDF anexado."} Selecione um arquivo apenas se quiser substituir ou adicionar o PDF.</p>
      <label>PDF (opcional)<input name="pdf" type="file" accept=".pdf,application/pdf" onChange={chooseFile} disabled={pending} /></label>
      {file && <p className="field-hint">Selecionado: {file.name}</p>}
    </section>
    <section className="form-panel"><label className={styles.reason}>Motivo da alteração
      <textarea name="reason" minLength={5} maxLength={1000} required disabled={pending} value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Descreva a correção para o histórico do contrato." /></label></section>
    {reviewing ? preview ? <ContractReview values={values} preview={preview} file={file} existingFileName={contract.contract_file_name}
      saving={pending} confirmLabel="Salvar alterações" onBack={() => setReviewing(false)} onConfirm={() => formRef.current?.requestSubmit()} /> :
      <section className="form-panel"><h2>Revise as alterações</h2><dl className="review-grid"><div><dt>Origem</dt><dd>{values.origin}</dd></div>
        <div><dt>Data do contrato</dt><dd>{values.contractDate}</dd></div><div><dt>PDF</dt><dd>{file?.name ?? contract.contract_file_name ?? "Sem PDF"}</dd></div></dl>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setReviewing(false)} disabled={pending}>Voltar</button>
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "Salvando..." : "Salvar alterações"}</button></div></section> :
      <div className="form-actions"><button className="primary-button" type="button" onClick={review} disabled={pending}>Revisar alterações →</button></div>}
  </form>;
}
