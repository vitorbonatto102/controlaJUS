"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { parseMoneyBR, participationCents } from "@/lib/contracts/finance";
import { buildSchedule, parseIsoDate, type ScheduleRow } from "@/lib/contracts/schedule";
import { formatCpf, hasPdfSignature, isValidCpf, isValidPdf, onlyDigits,
  ORIGINS, PERCENTAGES } from "@/lib/contracts/validation";

type FormValues = {
  clientName: string; cpf: string; contractDate: string; total: string; origin: string;
  percentage: string; method: "cash" | "installments"; cashValue: string; cashDue: string;
  count: string; installmentValue: string; firstDue: string;
  hasEntry: boolean; entryValue: string; entryDue: string;
};
type Preview = { rows: ScheduleRow[]; totalCents: number; sumCents: number; differenceCents: number;
  percentage: number; method: "cash" | "installments" };

const initialValues: FormValues = {
  clientName: "", cpf: "", contractDate: "", total: "", origin: "", percentage: "",
  method: "cash", cashValue: "", cashDue: "", count: "", installmentValue: "",
  firstDue: "", hasEntry: false, entryValue: "", entryDue: "",
};

function prepare(values: FormValues, file: File | null): Preview {
  if (values.clientName.trim().length < 2 || values.clientName.trim().length > 160) {
    throw new Error("Informe o nome completo do cliente.");
  }
  if (!isValidCpf(values.cpf)) throw new Error("Informe um CPF válido.");
  parseIsoDate(values.contractDate);
  if (!ORIGINS.some((origin) => origin === values.origin)) throw new Error("Selecione a origem da contratação.");
  const percentage = Number(values.percentage);
  if (!PERCENTAGES.some((item) => item === percentage)) throw new Error("Selecione um percentual permitido.");
  if (!file || !isValidPdf(file)) throw new Error("Anexe um PDF válido de até 10 MB.");
  const totalCents = parseMoneyBR(values.total);
  if (totalCents === null || totalCents <= 0) throw new Error("Informe o valor total contratado.");
  const plan = values.method === "cash" ? {
    method: "cash" as const, totalCents, cashCents: parseMoneyBR(values.cashValue) ?? 0,
    cashDueDate: values.cashDue,
  } : {
    method: "installments" as const, totalCents, count: Number(values.count),
    installmentCents: parseMoneyBR(values.installmentValue) ?? 0,
    firstDueDate: values.firstDue,
    ...(values.hasEntry ? { entryCents: parseMoneyBR(values.entryValue) ?? 0,
      entryDueDate: values.entryDue } : {}),
  };
  const schedule = buildSchedule(plan);
  return { ...schedule, totalCents, percentage, method: values.method };
}

export function NewContractForm({ lawyerId }: { lawyerId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"edit" | "review">("edit");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cpfNotice, setCpfNotice] = useState("");
  const set = (key: keyof FormValues, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  const checkCpf = async () => {
    setCpfNotice("");
    if (!isValidCpf(values.cpf)) return;
    const { data, error: lookupError } = await supabase.from("clients")
      .select("id, full_name").eq("cpf", onlyDigits(values.cpf)).maybeSingle();
    if (lookupError) { setCpfNotice("Não foi possível consultar este CPF agora."); return; }
    if (data) {
      setCpfNotice(`Cadastro existente: ${data.full_name}. O cliente será reutilizado.`);
      setValues((current) => ({ ...current, clientName: data.full_name }));
    } else {
      setCpfNotice("Se o CPF já existir no escritório, o cadastro será reutilizado ao confirmar.");
    }
  };

  const review = async () => {
    setError("");
    try {
      const nextPreview = prepare(values, file);
      if (!file || !(await hasPdfSignature(file))) throw new Error("O arquivo não possui assinatura de PDF válida.");
      setPreview(nextPreview);
      setPhase("review");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Verifique os dados informados."); }
  };

  const confirm = async () => {
    if (!preview || !file || saving) return;
    if (preview.differenceCents !== 0) { setError("Corrija a diferença entre contrato e cronograma antes de salvar."); return; }
    setSaving(true);
    setError("");
    const contractId = crypto.randomUUID();
    const filePath = `contracts/${lawyerId}/${contractId}/${crypto.randomUUID()}.pdf`;
    try {
      const { error: uploadError } = await supabase.storage.from("contract-pdfs")
        .upload(filePath, file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error(`Não foi possível enviar o PDF: ${uploadError.message}`);
      const { error: saveError } = await supabase.rpc("create_lawyer_contract", {
        p_contract_id: contractId,
        p_client_name: values.clientName.trim(), p_cpf: onlyDigits(values.cpf),
        p_contract_date: values.contractDate, p_total_cents: preview.totalCents,
        p_origin: values.origin, p_percentage: preview.percentage,
        p_payment_method: values.method, p_file_path: filePath, p_file_name: file.name,
        p_schedule: preview.rows,
      });
      if (saveError) {
        await supabase.storage.from("contract-pdfs").remove([filePath]);
        throw new Error(saveError.message);
      }
      router.push(`/advogada/contratos/${contractId}?criado=1`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o contrato.");
      setSaving(false);
    }
  };

  return <div className="contract-form-wrap">
    <div className="step-indicator"><span className={phase === "edit" ? "active" : ""}>1. Dados do contrato</span>
      <span className={phase === "review" ? "active" : ""}>2. Revisão e confirmação</span></div>
    {error && <div className="form-error-box" role="alert">{error}</div>}
    {phase === "edit" ? <form className="contract-form" onSubmit={(event) => { event.preventDefault(); void review(); }}>
      <section className="form-panel"><div className="form-section-heading"><span>01</span><div><h2>Cliente</h2><p>Dados de identificação do contratante.</p></div></div>
        <div className="form-grid"><label className="span-2">Nome completo<input required maxLength={160} value={values.clientName}
          onChange={(event) => set("clientName", event.target.value)} placeholder="Nome do cliente" /></label>
        <label>CPF<input required inputMode="numeric" value={values.cpf}
          onChange={(event) => { set("cpf", formatCpf(event.target.value)); setCpfNotice(""); }}
          onBlur={() => void checkCpf()} placeholder="000.000.000-00" maxLength={14} /></label></div>
        {cpfNotice && <p className="field-hint" role="status">{cpfNotice}</p>}
      </section>
      <section className="form-panel"><div className="form-section-heading"><span>02</span><div><h2>Contrato</h2><p>Origem e percentual são definidos separadamente.</p></div></div>
        <div className="form-grid"><label>Data do contrato<input required type="date" value={values.contractDate}
          onChange={(event) => set("contractDate", event.target.value)} /></label>
        <label>Valor total contratado<input required inputMode="decimal" value={values.total}
          onChange={(event) => { const next = event.target.value; setValues((current) => ({ ...current, total: next,
            cashValue: !current.cashValue || current.cashValue === current.total ? next : current.cashValue })); }}
          placeholder="10.000,00" /></label>
        <label>Origem da contratação<select required value={values.origin} onChange={(event) => set("origin", event.target.value)}>
          <option value="">Selecione</option>{ORIGINS.map((origin) => <option key={origin}>{origin}</option>)}</select></label>
        <label>Minha participação<select required value={values.percentage} onChange={(event) => set("percentage", event.target.value)}>
          <option value="">Selecione</option>{PERCENTAGES.map((percentage) => <option key={percentage} value={percentage}>{percentage}%</option>)}</select></label>
        <label className="span-2">Contrato em PDF (até 10 MB)<input required type="file" accept=".pdf,application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div>
      </section>
      <section className="form-panel"><div className="form-section-heading"><span>03</span><div><h2>Forma de pagamento</h2><p>O cronograma é gerado antes de salvar.</p></div></div>
        <div className="payment-choice"><label><input type="radio" name="payment-method" checked={values.method === "cash"}
          onChange={() => set("method", "cash")} /> À vista</label>
          <label><input type="radio" name="payment-method" checked={values.method === "installments"}
          onChange={() => set("method", "installments")} /> Parcelado</label></div>
        {values.method === "cash" ? <div className="form-grid"><label>Valor da parcela<input required inputMode="decimal"
          value={values.cashValue} onChange={(event) => set("cashValue", event.target.value)} placeholder="10.000,00" /></label>
          <label>Vencimento<input required type="date" value={values.cashDue} onChange={(event) => set("cashDue", event.target.value)} /></label></div> :
          <><div className="form-grid"><label>Quantidade de parcelas<input required type="number" min="1" max="120"
            value={values.count} onChange={(event) => set("count", event.target.value)} /></label>
          <label>Valor padrão de cada parcela<input required inputMode="decimal" value={values.installmentValue}
            onChange={(event) => set("installmentValue", event.target.value)} placeholder="1.000,00" /></label>
          <label>Primeiro vencimento<input required type="date" value={values.firstDue}
            onChange={(event) => set("firstDue", event.target.value)} /></label></div>
          <label className="checkbox-label"><input type="checkbox" checked={values.hasEntry}
            onChange={(event) => set("hasEntry", event.target.checked)} /> Possui entrada?</label>
          {values.hasEntry && <div className="form-grid"><label>Valor da entrada<input required inputMode="decimal"
            value={values.entryValue} onChange={(event) => set("entryValue", event.target.value)} placeholder="2.000,00" /></label>
            <label>Vencimento da entrada<input required type="date" value={values.entryDue}
              onChange={(event) => set("entryDue", event.target.value)} /></label></div>}</>}
      </section>
      <div className="form-actions"><button className="primary-button" type="submit">Revisar informações →</button></div>
    </form> : preview && <div className="review-content">
      <section className="form-panel"><div className="form-section-heading"><span>✓</span><div><h2>Revise as informações</h2>
        <p>Confira cada dado antes de confirmar. Você ainda pode voltar e corrigir.</p></div></div>
        <dl className="review-grid"><div><dt>Cliente</dt><dd>{values.clientName.trim()}</dd></div>
          <div><dt>CPF</dt><dd>{formatCpf(values.cpf)}</dd></div>
          <div><dt>Data do contrato</dt><dd>{formatDateBR(values.contractDate)}</dd></div>
          <div><dt>Origem</dt><dd>{values.origin}</dd></div>
          <div><dt>Valor contratado</dt><dd>{formatBRL(preview.totalCents / 100)}</dd></div>
          <div><dt>Minha participação</dt><dd>{preview.percentage}%</dd></div>
          <div><dt>Participação contratual estimada</dt><dd>{formatBRL(participationCents(preview.totalCents, preview.percentage) / 100)}</dd></div>
          <div><dt>Forma de pagamento</dt><dd>{preview.method === "cash" ? "À vista" : "Parcelado"}</dd></div>
          <div><dt>Quantidade de lançamentos</dt><dd>{preview.rows.length}</dd></div>
          <div><dt>PDF anexado</dt><dd>{file?.name}</dd></div></dl>
      </section>
      <section className="form-panel"><h2>Prévia do cronograma</h2>
        <div className="table-scroll"><table className="financial-table"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor contratual</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.installment_number}>
            <td>{row.kind === "down_payment" ? "Entrada" : `${row.regular_number}/${preview.rows.filter((item) => item.kind === "regular").length}`}</td>
            <td>{formatDateBR(row.due_date)}</td><td className="money-cell">{formatBRL(row.amount_cents / 100)}</td>
          </tr>)}</tbody></table></div>
        <div className={`schedule-balance ${preview.differenceCents ? "has-difference" : ""}`}>
          <span>Valor total do contrato <strong>{formatBRL(preview.totalCents / 100)}</strong></span>
          <span>Total do cronograma <strong>{formatBRL(preview.sumCents / 100)}</strong></span>
          <span>Diferença <strong>{formatBRL(preview.differenceCents / 100)}</strong></span>
        </div>
        {preview.differenceCents !== 0 && <p className="validation-note" role="alert">O cronograma diverge do contrato. Volte e corrija os valores antes de confirmar.</p>}
      </section>
      <div className="form-actions"><button className="secondary-button" type="button" disabled={saving}
        onClick={() => { setPhase("edit"); setError(""); }}>← Corrigir dados</button>
        <button className="primary-button" type="button" disabled={saving || preview.differenceCents !== 0}
          onClick={() => void confirm()}>{saving ? "Salvando contrato..." : "Confirmar contrato"}</button></div>
    </div>}
  </div>;
}
