"use client";

import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ExtractedContractData } from "@/lib/contracts/extraction";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { blankContractForm, prepareContract, type ContractFormValues,
  type ContractPreview } from "@/lib/contracts/registration";
import { formatCpf, hasPdfSignature, isValidCpf, isValidPdf, onlyDigits,
  ORIGINS, PERCENTAGES } from "@/lib/contracts/validation";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Mode = "choose" | "import" | "manual";
type EditKey = keyof ContractFormValues;
type SetField = <K extends EditKey>(key: K, value: ContractFormValues[K]) => void;
const dateInput = (value: string) => onlyDigits(value).slice(0, 8)
  .replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2");
const moneyInput = (value: string) => {
  const cents = parseMoneyBR(value);
  return cents === null ? value : formatBRL(cents / 100);
};

function Heading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="form-section-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function FieldNote({ note }: { note: string | null }) {
  return note ? <small className="extraction-hint">{note}</small> : null;
}

function ImportPanel({ mode, file, reading, stage, error, onFile, onManual }: {
  mode: Mode; file: File | null; reading: boolean; stage: string; error: string;
  onFile: (file: File) => void; onManual: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]);
  };
  return <section className={`import-panel ${dragging ? "is-dragging" : ""}`}
    onDragOver={(event) => event.preventDefault()} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={drop}>
    <p className="eyebrow">01 · IMPORTAR CONTRATO</p>
    <h2>Comece pelo contrato em PDF</h2>
    <p>Arraste o arquivo aqui ou selecione no computador. A leitura acontece em ambiente protegido.</p>
    <input ref={input} className="visually-hidden" type="file" accept=".pdf,application/pdf"
      aria-label="Selecionar contrato em PDF" disabled={reading}
      onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onFile(selected); event.target.value = ""; }} />
    <button type="button" className="primary-button" disabled={reading} onClick={() => input.current?.click()}>
      {file ? "Selecionar outro PDF" : "Selecionar contrato em PDF"}
    </button>
    <span className="upload-limit">Somente PDF · até 10 MB</span>
    {reading && <div className="import-progress" role="status"><strong>Lendo contrato...</strong><span>{stage}</span></div>}
    {mode === "import" && file && !reading && <div className="import-result" role="status">
      <strong>Contrato analisado com sucesso</strong><span>{file.name}</span>
      <p>Os dados encontrados foram preenchidos abaixo. Confira antes de continuar.</p>
    </div>}
    {error && <div className="form-error-box" role="alert">{error}</div>}
    {mode === "choose" && <button type="button" className="manual-link" onClick={onManual} disabled={reading}>
      ou cadastrar manualmente sem contrato
    </button>}
  </section>;
}

function ContractDataFields({ values, set, note, cpfNotice, checkCpf }: {
  values: ContractFormValues; set: SetField; note: (field: EditKey) => string | null;
  cpfNotice: string; checkCpf: () => void;
}) {
  return <>
    <section className="form-panel"><Heading number="02" title="Contratante"
      description="Confirme a identificação da pessoa contratante." />
      <div className="form-grid"><label className="span-2">Nome completo
        <input maxLength={160} value={values.clientName} onChange={(event) => set("clientName", event.target.value)}
          placeholder="Nome completo" /><FieldNote note={note("clientName")} /></label>
        <label>CPF<input inputMode="numeric" maxLength={14} value={values.cpf}
          onChange={(event) => set("cpf", formatCpf(event.target.value))} onBlur={checkCpf}
          placeholder="000.000.000-00" /><FieldNote note={note("cpf")} /></label></div>
      {cpfNotice && <p className="field-hint" role="status">{cpfNotice}</p>}
    </section>
    <section className="form-panel"><Heading number="03" title="Contrato"
      description="Honorários principais contratados com o cliente." />
      <div className="form-grid"><label>Data do contrato
        <input inputMode="numeric" maxLength={10} value={values.contractDate}
          onChange={(event) => set("contractDate", dateInput(event.target.value))} placeholder="DD/MM/AAAA" />
        <FieldNote note={note("contractDate")} /></label>
        <label>Valor total contratado<input inputMode="decimal" value={values.total}
          onChange={(event) => set("total", event.target.value)} onBlur={() => set("total", moneyInput(values.total))}
          placeholder="R$ 4.000,00" /><FieldNote note={note("total")} /></label></div>
    </section>
    <section className="form-panel"><Heading number="04" title="Forma de pagamento"
      description="As datas só serão criadas quando houver um primeiro vencimento definido." />
      <div className="payment-choice" role="group" aria-label="Forma de pagamento">
        <label><input type="radio" name="payment-method" checked={values.method === "cash"}
          onChange={() => { set("method", "cash"); set("count", "1"); set("lastInstallmentValue", ""); }} /> À vista</label>
        <label><input type="radio" name="payment-method" checked={values.method === "installments"}
          onChange={() => { set("method", "installments"); if (values.count === "1") set("count", ""); }} /> Parcelado</label>
      </div><FieldNote note={note("method")} />
      {values.method && <div className="form-grid">
        {values.method === "installments" && <label>Quantidade de parcelas
          <input type="number" min="1" max="120" value={values.count}
            onChange={(event) => set("count", event.target.value)} placeholder="20" />
          <FieldNote note={note("count")} /></label>}
        <label>{values.method === "cash" ? "Valor à vista" : "Valor de cada parcela"}
          <input inputMode="decimal" value={values.installmentValue}
            onChange={(event) => set("installmentValue", event.target.value)}
            onBlur={() => set("installmentValue", moneyInput(values.installmentValue))}
            placeholder="R$ 200,00" /><FieldNote note={note("installmentValue")} /></label>
        {values.method === "installments" && <label>Última parcela, se diferente (opcional)
          <input inputMode="decimal" value={values.lastInstallmentValue}
            onChange={(event) => set("lastInstallmentValue", event.target.value)}
            onBlur={() => set("lastInstallmentValue", moneyInput(values.lastInstallmentValue))}
            placeholder="Informe se houver diferença de centavos" />
          <small className="extraction-hint">O valor informado aparecerá na revisão do cronograma.</small></label>}
      </div>}
      {values.method && <><div className="start-choice" role="group" aria-label="Início dos pagamentos">
        <label><input type="radio" name="payment-start" checked={values.paymentStartType === "fixed_date"}
          onChange={() => { set("paymentStartType", "fixed_date"); set("paymentStartCondition", ""); }} /> Data fixa</label>
        <label><input type="radio" name="payment-start" checked={values.paymentStartType === "condition"}
          onChange={() => { set("paymentStartType", "condition"); set("firstDue", ""); set("hasEntry", false); }} /> Início condicionado</label>
      </div>
      {values.paymentStartType === "fixed_date" && <div className="form-grid"><label>Data da primeira parcela
        <input inputMode="numeric" maxLength={10} value={values.firstDue}
          onChange={(event) => set("firstDue", dateInput(event.target.value))} placeholder="DD/MM/AAAA" />
        <FieldNote note={note("firstDue")} /></label></div>}
      {values.paymentStartType === "condition" && <div className="condition-block">
        <label>Condição para início dos pagamentos
          <textarea maxLength={500} rows={3} value={values.paymentStartCondition}
            onChange={(event) => set("paymentStartCondition", event.target.value)}
            placeholder="Ex.: Após a liberação dos valores de indenização." />
          <FieldNote note={note("paymentStartCondition")} /></label>
        <p>Este contrato não define uma data fixa para o primeiro vencimento. Informe a data quando ela for conhecida para gerar o cronograma.</p>
      </div>}
      {values.method === "installments" && values.paymentStartType === "fixed_date" && <>
        <label className="checkbox-label"><input type="checkbox" checked={values.hasEntry}
          onChange={(event) => set("hasEntry", event.target.checked)} /> Possui entrada?</label>
        {values.hasEntry && <div className="form-grid"><label>Valor da entrada
          <input inputMode="decimal" value={values.entryValue} onChange={(event) => set("entryValue", event.target.value)}
            onBlur={() => set("entryValue", moneyInput(values.entryValue))} placeholder="R$ 1.000,00" /></label>
          <label>Vencimento da entrada<input inputMode="numeric" maxLength={10} value={values.entryDue}
            onChange={(event) => set("entryDue", dateInput(event.target.value))} placeholder="DD/MM/AAAA" /></label></div>}
      </>}</>}
    </section>
  </>;
}

function InternalFields({ values, set, note }: {
  values: ContractFormValues; set: SetField; note: (field: EditKey) => string | null;
}) {
  return <>
    <section className="form-panel"><Heading number="05" title="Informações internas"
      description="Origem e participação da advogada são definidos por você." />
      <div className="form-grid"><label>Origem da contratação<select value={values.origin}
        onChange={(event) => set("origin", event.target.value)}><option value="">Selecione</option>
        {ORIGINS.map((origin) => <option key={origin}>{origin}</option>)}</select></label>
        <label>Minha participação<select value={values.percentage}
          onChange={(event) => set("percentage", event.target.value)}><option value="">Selecione</option>
          {PERCENTAGES.map((percentage) => <option key={percentage} value={percentage}>{percentage}%</option>)}</select></label></div>
    </section>
    <section className="additional-fee-panel"><div><p className="eyebrow">HONORÁRIOS ADICIONAIS</p>
      <p>Obrigação eventual do cliente, separada da participação da advogada.</p></div>
      <label className="checkbox-label"><input type="checkbox" checked={values.hasAdditionalFee}
        onChange={(event) => set("hasAdditionalFee", event.target.checked)} /> Contrato prevê honorários adicionais</label>
      {values.hasAdditionalFee && <div className="form-grid"><label>Percentual contratual
        <input type="number" min="0.01" max="100" step="0.01" value={values.additionalFeePercentage}
          onChange={(event) => set("additionalFeePercentage", event.target.value)} placeholder="30" />
        <FieldNote note={note("additionalFeePercentage")} /></label>
        <label>Base dos honorários adicionais
          <input maxLength={200} value={values.additionalFeeBasis}
            onChange={(event) => set("additionalFeeBasis", event.target.value)} placeholder="Proveito econômico" />
          <FieldNote note={note("additionalFeeBasis")} /></label>
        <label className="span-2">Valor eventual dos honorários adicionais (opcional)
          <input inputMode="decimal" value={values.additionalFeeAmount}
            onChange={(event) => set("additionalFeeAmount", event.target.value)}
            onBlur={() => set("additionalFeeAmount", moneyInput(values.additionalFeeAmount))}
            placeholder="Valor ainda não informado" /></label></div>}
    </section>
  </>;
}

function Review({ values, preview, file, saving, onBack, onConfirm }: {
  values: ContractFormValues; preview: ContractPreview; file: File | null; saving: boolean;
  onBack: () => void; onConfirm: () => void;
}) {
  const pending = values.paymentStartType === "condition";
  return <div className="review-content">
    <section className="form-panel"><Heading number="✓" title="Revise as informações"
      description="Confira os dados. Você pode voltar e corrigir qualquer campo." />
      <dl className="review-grid"><div><dt>Contratante</dt><dd>{values.clientName.trim()}</dd></div>
        <div><dt>CPF</dt><dd>{formatCpf(values.cpf)}</dd></div>
        <div><dt>Data do contrato</dt><dd>{values.contractDate}</dd></div>
        <div><dt>Valor total</dt><dd>{formatBRL(preview.totalCents / 100)}</dd></div>
        <div><dt>Forma de pagamento</dt><dd>{values.method === "cash" ? "À vista" : "Parcelado"}</dd></div>
        <div><dt>Parcelas</dt><dd>{preview.installmentCount} × {formatBRL(preview.installmentCents / 100)}{
          preview.lastInstallmentCents !== null ? ` · última: ${formatBRL(preview.lastInstallmentCents / 100)}` : ""}</dd></div>
        <div><dt>Início dos pagamentos</dt><dd>{pending ? values.paymentStartCondition : values.firstDue}</dd></div>
        <div><dt>Origem</dt><dd>{values.origin}</dd></div>
        <div><dt>Minha participação</dt><dd>{preview.percentage}%</dd></div>
        <div><dt>PDF</dt><dd>{file?.name ?? "Cadastro manual sem PDF"}</dd></div></dl>
      {values.hasAdditionalFee && <p className="review-additional">
        Honorários adicionais previstos: {values.additionalFeePercentage ? `${values.additionalFeePercentage}%` : "percentual não informado"} sobre {
          values.additionalFeeBasis || "base não informada"} — {preview.additionalFeeAmountCents === null ?
          "valor ainda não informado" : formatBRL(preview.additionalFeeAmountCents / 100)}.
      </p>}
    </section>
    <section className="form-panel"><h2>Revisar cronograma</h2>
      {pending ? <div className="pending-schedule"><strong>Aguardando definição do primeiro vencimento</strong>
        <p>Nenhuma parcela será criada até que exista uma data real para iniciar os pagamentos.</p></div> :
        <div className="table-scroll"><table className="financial-table"><thead><tr><th>Parcela</th>
          <th>Vencimento</th><th>Valor contratual</th></tr></thead><tbody>
          {preview.rows.map((row) => <tr key={row.installment_number}><td>{row.kind === "down_payment" ?
            "Entrada" : `${row.regular_number}/${preview.installmentCount}`}</td>
            <td>{formatDateBR(row.due_date)}</td><td className="money-cell">{formatBRL(row.amount_cents / 100)}</td></tr>)}
        </tbody></table></div>}
      <div className={`schedule-balance ${preview.differenceCents ? "has-difference" : ""}`}>
        <span>Valor total do contrato <strong>{formatBRL(preview.totalCents / 100)}</strong></span>
        <span>{pending ? "Total previsto" : "Total do cronograma"}
          <strong>{formatBRL(preview.sumCents / 100)}</strong></span>
        <span>Diferença <strong>{formatBRL(preview.differenceCents / 100)}</strong></span>
      </div>
      {preview.differenceCents !== 0 && <p className="validation-note" role="alert">
        Os valores extraídos não fecham exatamente com o valor total do contrato. Confira antes de continuar.
      </p>}
    </section>
    <div className="form-actions"><button className="secondary-button" type="button" disabled={saving}
      onClick={onBack}>← Corrigir dados</button>
      <button className="primary-button" type="button" disabled={saving || preview.differenceCents !== 0}
        onClick={onConfirm}>{saving ? "Salvando contrato..." : "Confirmar contrato"}</button></div>
  </div>;
}

export function NewContractForm({ lawyerId }: { lawyerId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [mode, setMode] = useState<Mode>("choose");
  const [phase, setPhase] = useState<"edit" | "review">("edit");
  const [values, setValues] = useState<ContractFormValues>(blankContractForm);
  const [extractedFields, setExtractedFields] = useState<Set<EditKey>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ContractPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [readingStage, setReadingStage] = useState("");
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [cpfNotice, setCpfNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const set: SetField = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setExtractedFields((current) => { const next = new Set(current); next.delete(key); return next; });
    if (key === "cpf") setCpfNotice("");
  };
  const note = (field: EditKey): string | null => {
    if (mode !== "import") return null;
    if (extractedFields.has(field)) return "Extraído do contrato";
    const value = values[field];
    return typeof value === "string" && !value.trim() ? "Não identificado no contrato — preencha manualmente." : null;
  };

  const applyExtracted = (data: ExtractedContractData) => {
    const next: ContractFormValues = { ...blankContractForm,
      clientName: data.contractorName ?? "", cpf: formatCpf(data.cpf ?? ""),
      contractDate: data.contractDate ?? "", total: data.totalValue ? moneyInput(data.totalValue) : "",
      method: data.paymentType ?? "", count: data.installmentCount?.toString() ?? "",
      installmentValue: data.installmentValue ? moneyInput(data.installmentValue) : "",
      firstDue: data.firstDueDate ?? "", paymentStartType: data.paymentStartType ?? "",
      paymentStartCondition: data.paymentStartCondition ?? "",
      hasAdditionalFee: data.hasAdditionalFee,
      additionalFeePercentage: data.additionalFeePercentage?.toString() ?? "",
      additionalFeeBasis: data.additionalFeeBasis ?? "",
    };
    const extracted = new Set<EditKey>();
    for (const key of ["clientName", "cpf", "contractDate", "total", "method", "count",
      "installmentValue", "firstDue", "paymentStartCondition", "additionalFeePercentage",
      "additionalFeeBasis"] as const) {
      if (next[key]) extracted.add(key);
    }
    setValues(next);
    setExtractedFields(extracted);
  };

  const importFile = async (selected: File) => {
    if (reading) return;
    setImportError("");
    setError("");
    if (!isValidPdf(selected) || !(await hasPdfSignature(selected))) {
      setImportError("Selecione um PDF válido de até 10 MB.");
      return;
    }
    setReading(true);
    setReadingStage("Preparando envio seguro do PDF...");
    const path = `contracts/${lawyerId}/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
    try {
      const { error: uploadError } = await supabase.storage.from("contract-pdfs")
        .upload(path, selected, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error(`Não foi possível enviar o PDF: ${uploadError.message}`);
      setReadingStage("Identificando dados do contratante e honorários...");
      const result = await fetch("/api/contracts/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }), cache: "no-store",
      });
      const payload = await result.json().catch(() => null) as
        { data?: ExtractedContractData; error?: string } | null;
      if (!result.ok || !payload?.data) throw new Error(payload?.error ?? "Não foi possível analisar o PDF.");
      applyExtracted(payload.data);
      setFile(selected);
      setMode("import");
      setPhase("edit");
      setPreview(null);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Não foi possível ler o PDF.");
    } finally {
      // A rota também limpa o upload. Esta tentativa cobre falhas antes da chamada.
      await supabase.storage.from("contract-pdfs").remove([path]);
      setReading(false);
    }
  };

  const checkCpf = async () => {
    setCpfNotice("");
    if (!isValidCpf(values.cpf)) return;
    const { data, error: lookupError } = await supabase.from("clients")
      .select("id, full_name").eq("cpf", onlyDigits(values.cpf)).maybeSingle();
    if (lookupError) { setCpfNotice("Não foi possível consultar este CPF agora."); return; }
    if (data) {
      setCpfNotice(`Cadastro existente: ${data.full_name}. O cliente será reutilizado.`);
      setValues((current) => ({ ...current, clientName: data.full_name }));
      setExtractedFields((current) => { const next = new Set(current); next.delete("clientName"); return next; });
    } else {
      setCpfNotice("Se o CPF já existir no escritório, o cadastro será reutilizado ao confirmar.");
    }
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const next = prepareContract(values);
      if (mode === "import" && (!file || !isValidPdf(file))) throw new Error("Selecione novamente o PDF.");
      setPreview(next);
      setPhase("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confira os dados informados.");
    }
  };

  const confirm = async () => {
    if (!preview || saving || preview.differenceCents !== 0) return;
    setSaving(true);
    setError("");
    const contractId = crypto.randomUUID();
    const filePath = file ? `contracts/${lawyerId}/${contractId}/${crypto.randomUUID()}.pdf` : null;
    let saved = false;
    try {
      if (file && filePath) {
        if (!isValidPdf(file) || !(await hasPdfSignature(file))) throw new Error("Selecione novamente um PDF válido.");
        const { error: uploadError } = await supabase.storage.from("contract-pdfs")
          .upload(filePath, file, { contentType: "application/pdf", upsert: false });
        if (uploadError) throw new Error(`Não foi possível enviar o PDF: ${uploadError.message}`);
      }
      const { error: saveError } = await supabase.rpc("create_lawyer_contract_v2", {
        p_contract_id: contractId, p_client_name: values.clientName.trim(),
        p_cpf: onlyDigits(values.cpf), p_contract_date: preview.contractDate,
        p_total_cents: preview.totalCents, p_origin: values.origin,
        p_percentage: preview.percentage, p_payment_method: values.method,
        p_file_path: filePath, p_file_name: file?.name ?? null,
        p_schedule: preview.rows, p_payment_start_type: values.paymentStartType,
        p_first_due_date: preview.firstDueDate,
        p_payment_start_condition: values.paymentStartType === "condition" ? values.paymentStartCondition.trim() : null,
        p_installment_count: preview.installmentCount, p_installment_cents: preview.installmentCents,
        p_has_additional_fee: values.hasAdditionalFee,
        p_additional_fee_percentage: values.hasAdditionalFee && values.additionalFeePercentage ?
          Number(values.additionalFeePercentage) : null,
        p_additional_fee_basis: values.hasAdditionalFee ? values.additionalFeeBasis.trim() || null : null,
        p_additional_fee_amount_cents: preview.additionalFeeAmountCents,
        p_last_installment_cents: preview.lastInstallmentCents,
      });
      if (saveError) throw new Error(saveError.message);
      saved = true;
      router.push(`/advogada/contratos/${contractId}?criado=1`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o contrato.");
    } finally {
      if (!saved && filePath) await supabase.storage.from("contract-pdfs").remove([filePath]);
      setSaving(false);
    }
  };

  const manual = () => {
    setValues({ ...blankContractForm }); setExtractedFields(new Set()); setFile(null);
    setMode("manual"); setPhase("edit"); setPreview(null); setImportError(""); setError("");
  };

  return <div className="contract-form-wrap">
    <div className="step-indicator"><span className={mode === "choose" ? "active" : ""}>1. Importar contrato</span>
      <span className={mode !== "choose" && phase === "edit" ? "active" : ""}>2. Conferir dados</span>
      <span className={mode !== "choose" && phase === "edit" ? "active" : ""}>3. Informações internas</span>
      <span className={phase === "review" ? "active" : ""}>4. Revisar cronograma</span></div>
    {phase === "edit" && <ImportPanel mode={mode} file={file} reading={reading} stage={readingStage}
      error={importError} onFile={(selected) => void importFile(selected)} onManual={manual} />}
    {mode === "manual" && phase === "edit" && <p className="manual-status">Cadastro manual sem contrato em PDF.</p>}
    {error && <div className="form-error-box" role="alert">{error}</div>}
    {mode !== "choose" && phase === "edit" && <form className="contract-form" noValidate onSubmit={review}>
      <ContractDataFields values={values} set={set} note={note} cpfNotice={cpfNotice} checkCpf={() => void checkCpf()} />
      <InternalFields values={values} set={set} note={note} />
      <div className="form-actions"><button className="primary-button" type="submit">Revisar informações →</button></div>
    </form>}
    {phase === "review" && preview && <Review values={values} preview={preview} file={file} saving={saving}
      onBack={() => { setPhase("edit"); setError(""); }} onConfirm={() => void confirm()} />}
  </div>;
}
