"use client";

import { useActionState, useMemo, useState } from "react";
import { FinancialCard } from "@/components/financial-card";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import type { ManagerWorkspace } from "@/lib/manager/data";
import { buildManagerPaymentRows, filterManagerRows, managerDelinquency,
  managerTotals, transferDeadline, type ManagerPaymentRow } from "@/lib/manager/view";
import { confirmClosing, correctField, correctPayment, emptyManagerState, recordLatePayment,
  registerTransfer, reverseTransfer } from "@/app/gestor/actions";
import type { AuditEntry, Closing } from "@/lib/finance/data";
import { operationalStatusLabels } from "@/lib/secretary/view";

const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
  "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const money = (cents: number) => formatBRL(cents / 100);
const closingStatus: Record<string, string> = {
  draft: "Em apuração", closed: "Fechado", partial: "Parcialmente pago", paid: "Pago",
};
const fieldLabels: Record<string, string> = {
  full_name: "Nome do cliente", cpf: "CPF", origin: "Origem",
  contract_date: "Data do contrato", total_contract_value: "Valor do contrato",
  due_date: "Vencimento", contractual_amount: "Valor contratual da parcela",
  commission_percentage: "Percentual", content: "Anotação", note_type: "Tipo da anotação",
};
const isMoneyField = (field: string) => field === "total_contract_value" || field === "contractual_amount";
function displayAuditValue(value: unknown, field: string): string {
  if (value === null || value === undefined) return "—";
  if (isMoneyField(field) && (typeof value === "number" || typeof value === "string")) {
    return formatBRL(Number(value));
  }
  if (field.endsWith("date") && typeof value === "string") {
    try { return formatDateBR(value); } catch { /* valor antigo legado */ }
  }
  if (typeof value === "object" && "amount_paid" in value && value.amount_paid !== undefined) {
    const record = value as { amount_paid: number; payment_date?: string };
    return `${formatBRL(Number(record.amount_paid))}${record.payment_date ? ` · ${formatDateBR(record.payment_date)}` : ""}`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function Feedback({ state }: { state: { error: string | null; success: string | null } }) {
  return <>{state.error && <p className="form-error-box" role="alert">{state.error}</p>}
    {state.success && <p className="success-box" role="status">{state.success}</p>}</>;
}

function AuditDetails({ entries, users }: { entries: AuditEntry[]; users: { id: string; full_name: string }[] }) {
  if (!entries.length) return null;
  return <details className="operation-details"><summary>Corrigido · ver histórico ({entries.length})</summary>
    <ul className="audit-list">{entries.map((entry) => <li key={entry.id}>
      <strong>{fieldLabels[entry.field_name] ?? entry.field_name}</strong> · {users.find((user) => user.id === entry.user_id)?.full_name ?? "Gestor"} · {new Date(entry.created_at).toLocaleString("pt-BR")}
      <span>Anterior: {displayAuditValue(entry.old_value, entry.field_name)} → Atual: {displayAuditValue(entry.new_value, entry.field_name)}</span>
      <span>Motivo: {entry.reason}</span>
    </li>)}</ul>
  </details>;
}

function FieldCorrection({ table, recordId, field, current, label, options }: {
  table: string; recordId: string; field: string; current: string; label: string;
  options?: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(correctField, emptyManagerState);
  const displayCurrent = isMoneyField(field) ? formatBRL(Number(current)) :
    (field.endsWith("date") ? formatDateBR(current) : field === "commission_percentage" ? `${current}%` : current);
  const defaultInput = isMoneyField(field) ? formatBRL(Number(current)) : current;
  return <details className="operation-details"><summary>Corrigir {label.toLocaleLowerCase("pt-BR")}</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="table" value={table} /><input type="hidden" name="record_id" value={recordId} />
      <input type="hidden" name="field" value={field} />
      <p>Valor atual: <strong>{displayCurrent}</strong></p>
      {field === "total_contract_value" && <p>Esta alteração não muda automaticamente os valores das parcelas. Confira o cronograma e corrija cada parcela, se necessário.</p>}
      <label>Novo valor{options ? <select name="new_value" defaultValue={current}>
        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select> : field === "content" ? <textarea name="new_value" defaultValue={current}
        maxLength={3000} rows={3} required /> : <input name="new_value"
          type={field.endsWith("date") ? "date" : "text"} defaultValue={defaultInput} required />}</label>
      <label>Motivo da correção<textarea name="reason" minLength={5} maxLength={1000} required /></label>
      <button type="submit" className="secondary-button" disabled={pending}>Confirmar correção</button>
      <Feedback state={state} />
    </form>
  </details>;
}

function PaymentCorrection({ row }: { row: ManagerPaymentRow }) {
  const [state, action, pending] = useActionState(correctPayment, emptyManagerState);
  const [mode, setMode] = useState("replace");
  return <details className="operation-details"><summary>Corrigir pagamento</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="payment_id" value={row.paymentId} />
      <p>Atual: <strong>{money(row.paidCents)} · {formatDateBR(row.paymentDate)}</strong></p>
      <label>Ação<select name="mode" value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="replace">Estornar e substituir</option><option value="void">Somente estornar</option>
      </select></label>
      {mode === "replace" && <><label>Novo valor (R$)<input name="amount" defaultValue={(row.paidCents / 100).toFixed(2).replace(".", ",")} required /></label>
        <label>Nova data<input name="payment_date" type="date" defaultValue={row.paymentDate} required /></label></>}
      <label>Motivo<textarea name="reason" minLength={5} maxLength={1000} required /></label>
      <button type="submit" className="secondary-button" disabled={pending}>Confirmar correção</button>
      <Feedback state={state} />
    </form>
  </details>;
}

function LatePaymentForm({ installmentId }: { installmentId: string }) {
  const [state, action, pending] = useActionState(recordLatePayment, emptyManagerState);
  return <details className="operation-details"><summary>Lançamento complementar</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="installment_id" value={installmentId} />
      <label>Valor recebido (R$)<input name="amount" required /></label>
      <label>Data do recebimento<input name="payment_date" type="date" required /></label>
      <label>Observação<textarea name="observation" maxLength={1000} /></label>
      <label>Motivo do lançamento posterior<textarea name="reason" minLength={5} maxLength={1000} required /></label>
      <button type="submit" className="secondary-button" disabled={pending}>Registrar com ajuste</button>
      <Feedback state={state} />
    </form>
  </details>;
}

function ClosingPreview({ lawyerId, month, year, rows, today }: {
  lawyerId: string; month: number; year: number; rows: ManagerPaymentRow[]; today: string;
}) {
  const [state, action, pending] = useActionState(confirmClosing, emptyManagerState);
  const received = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const commission = rows.reduce((sum, row) => sum + row.commissionCents, 0);
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const eligible = today >= lastDay;
  return <section className="workspace-panel"><h2>Em apuração · {months[month - 1]}/{year}</h2>
    <p>{rows.length} recebimento(s) · Escritório: {money(received)} · Comissão: {money(commission)}</p>
    {rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr>
      <th>Cliente</th><th>Pagamento</th><th>Data</th><th>%</th><th>Comissão</th>
    </tr></thead><tbody>{rows.map((row) => <tr key={row.paymentId}><td>{row.clientName}</td>
      <td>{money(row.paidCents)}</td><td>{formatDateBR(row.paymentDate)}</td>
      <td>{row.percentage}%</td><td>{money(row.commissionCents)}</td></tr>)}</tbody></table></div>
      : <p>Nenhum pagamento encontrado neste período.</p>}
    {!eligible && <p>O fechamento poderá ser confirmado a partir de {formatDateBR(lastDay)}.</p>}
    <form action={action} className="operation-form inline-form">
      <input type="hidden" name="lawyer_id" value={lawyerId} />
      <input type="hidden" name="month" value={month} /><input type="hidden" name="year" value={year} />
      <label><input type="checkbox" name="confirm" value="yes" required /> Conferi a composição do fechamento</label>
      <button type="submit" className="primary-button" disabled={pending || !eligible}>Confirmar fechamento</button>
      <Feedback state={state} />
    </form>
  </section>;
}

function TransferForm({ closing }: { closing: Closing }) {
  const [state, action, pending] = useActionState(registerTransfer, emptyManagerState);
  const [amount, setAmount] = useState("");
  const cents = parseMoneyBR(amount) ?? 0;
  const pendingCents = Math.round(closing.amount_pending_transfer * 100);
  return <details className="operation-details"><summary>Registrar repasse</summary>
    <form action={action} className="operation-form">
      <input type="hidden" name="closing_id" value={closing.id} />
      <p>Comissão ajustada: {formatBRL(closing.commission_amount + closing.adjustment_amount)} ·
        Já repassado: {formatBRL(closing.amount_already_transferred)} · Saldo: {formatBRL(closing.amount_pending_transfer)}</p>
      <label>Novo repasse (R$)<input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
      <label>Data do pagamento<input name="payment_date" type="date" required /></label>
      <label>Observação<textarea name="notes" maxLength={1000} /></label>
      {cents > 0 && <p>Saldo após repasse: <strong>{money(pendingCents - cents)}</strong></p>}
      {cents > pendingCents && <p className="form-error-box">O valor supera o saldo. Corrija o fechamento antes de registrar.</p>}
      <button type="submit" className="primary-button" disabled={pending || cents > pendingCents}>Confirmar repasse</button>
      <Feedback state={state} />
    </form>
  </details>;
}

function ReverseTransferForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(reverseTransfer, emptyManagerState);
  return <details className="operation-details"><summary>Reverter repasse</summary>
    <form action={action} className="operation-form"><input type="hidden" name="transfer_id" value={id} />
      <label>Motivo<textarea name="reason" minLength={5} maxLength={1000} required /></label>
      <button className="secondary-button" disabled={pending}>Confirmar reversão</button><Feedback state={state} />
    </form></details>;
}

export function ManagerDashboard({ data, today }: { data: ManagerWorkspace; today: string }) {
  const [lawyerId, setLawyerId] = useState("");
  const [month, setMonth] = useState(today.slice(5, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [client, setClient] = useState("");
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState("");
  const rows = useMemo(() => buildManagerPaymentRows(data, today), [data, today]);
  const periodRows = filterManagerRows(rows, { lawyerId, month, year, client: "", origin: "", status: "" });
  const filtered = filterManagerRows(rows, { lawyerId, month, year, client, origin, status });
  const periodClosings = data.closings.filter((closing) =>
    (!lawyerId || closing.lawyer_id === lawyerId) &&
    (!month || closing.reference_month === Number(month)) &&
    (!year || closing.reference_year === Number(year)));
  const transferredCents = periodClosings.reduce((sum, closing) =>
    sum + Math.round(closing.amount_already_transferred * 100), 0);
  const totals = managerTotals(periodRows, transferredCents);
  const delinquency = managerDelinquency(data, today, { lawyerId, month, year, client });
  const delinquentCount = delinquency.reduce((sum, row) => sum + row.installmentCount, 0);
  const selectedLawyer = data.lawyers.find((item) => item.id === lawyerId);
  const selectedClosing = periodClosings.find((item) => item.lawyer_id === lawyerId);
  const previewRows = rows.filter((row) => row.lawyerId === lawyerId &&
    row.paymentDate.slice(0, 7) === `${year}-${month}`);
  const summaryByLawyer = data.lawyers.map((lawyer) => {
    const theirRows = periodRows.filter((row) => row.lawyerId === lawyer.id);
    const theirTransfers = periodClosings.filter((closing) => closing.lawyer_id === lawyer.id)
      .reduce((sum, closing) => sum + Math.round(closing.amount_already_transferred * 100), 0);
    return { lawyer, totals: managerTotals(theirRows, theirTransfers) };
  });

  return <>
    <section className="workspace-panel"><h2>Filtros de análise</h2><div className="manager-filters">
      <label>Advogada<select value={lawyerId} onChange={(e) => setLawyerId(e.target.value)}>
        <option value="">Todas as advogadas</option>{data.lawyers.filter((item) => item.active).map((item) =>
          <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
      <label>Mês<select value={month} onChange={(e) => setMonth(e.target.value)}>
        {months.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}</select></label>
      <label>Ano<select value={year} onChange={(e) => setYear(e.target.value)}>
        {Array.from(new Set([...Array.from({ length: 6 }, (_, index) => Number(today.slice(0, 4)) - index),
          ...rows.map((row) => Number(row.paymentDate.slice(0, 4))),
          ...data.closings.map((item) => item.reference_year)])).sort((a, b) => b - a)
          .map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Cliente<input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Buscar nome" /></label>
      <label>Origem<select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="">Todas</option>
        {["Cliente próprio", "Propriedade Intelectual", "Tráfego HP"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>
        <option value="paid">Paga</option><option value="partial">Parcial</option>
        <option value="overdue">Vencida</option><option value="today">Vence hoje</option>
        <option value="upcoming">A vencer</option></select></label>
    </div><p className="filter-hint">Os cards financeiros usam advogada, mês e ano. Cliente, origem e status refinam a composição; cliente também refina a inadimplência.</p></section>

    <section className="card-grid manager-cards" aria-label="Resumo do período">
      <FinancialCard title="Recebido pelo escritório" value={money(totals.receivedCents)} hint="Pagamentos válidos no período" />
      <FinancialCard title="Comissão gerada" value={money(totals.commissionCents)} hint="Sobre recebimentos efetivos" />
      <FinancialCard title="Já repassado" value={money(totals.transferredCents)} hint="Repasses ativos dos fechamentos" />
      <FinancialCard title="Saldo a repassar" value={money(totals.pendingCents)} hint="Comissão do período menos repasses" />
      <FinancialCard title="Clientes com recebimento" value={String(totals.clientCount)} hint="Clientes distintos no período" />
      <FinancialCard title="Parcelas inadimplentes" value={String(delinquentCount)} hint="Vencidas no período filtrado e ainda abertas" />
    </section>

    {!lawyerId && <section className="workspace-panel"><h2>Todas as advogadas</h2>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Advogada</th>
        <th>Recebido pelo escritório</th><th>Comissão gerada</th><th>Repassado</th><th>Saldo pendente</th>
      </tr></thead><tbody>{summaryByLawyer.map(({ lawyer, totals: item }) => <tr key={lawyer.id}>
        <td><button type="button" className="text-button" onClick={() => setLawyerId(lawyer.id)}>{lawyer.full_name}</button></td>
        <td>{money(item.receivedCents)}</td><td>{money(item.commissionCents)}</td>
        <td>{money(item.transferredCents)}</td><td>{money(item.pendingCents)}</td></tr>)}</tbody></table></div>
      {!summaryByLawyer.length && <p>Nenhuma advogada cadastrada.</p>}
    </section>}

    {lawyerId && <section className="workspace-panel"><h2>Composição do período · {selectedLawyer?.full_name}</h2>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr>
        <th>Cliente</th><th>Origem</th><th>Parcela</th><th>Vencimento</th><th>Valor contratual</th>
        <th>Valor pago</th><th>Data do pagamento</th><th>%</th><th>Comissão gerada</th><th>Status</th><th>Ações</th>
      </tr></thead><tbody>{filtered.map((row) => {
        const corrections = data.audit.filter((entry) => entry.table_name === "payments" &&
          (entry.record_id === row.paymentId || entry.record_id === row.replacesPaymentId));
        return <tr key={row.paymentId}><td>{row.clientName}</td><td>{row.origin}</td>
          <td>{row.installmentLabel}</td><td>{formatDateBR(row.dueDate)}</td>
          <td>{money(row.contractualCents)}</td><td>{money(row.paidCents)}</td>
          <td>{formatDateBR(row.paymentDate)}</td><td>{row.percentage}%</td>
          <td>{money(row.commissionCents)}</td><td>{operationalStatusLabels[row.status as keyof typeof operationalStatusLabels]}{row.corrected && <small> · Corrigido</small>}</td>
          <td><PaymentCorrection row={row} /><AuditDetails entries={corrections} users={data.users} /></td></tr>;
      })}</tbody></table></div> : <p>Nenhum pagamento encontrado neste período.</p>}
    </section>}

    {lawyerId && <section className="workspace-panel"><h2>Correções cadastrais · {selectedLawyer?.full_name}</h2>
      <div className="correction-grid">{data.contracts.filter((item) => item.lawyer_id === lawyerId).map((contract) => {
        const term = data.terms.find((item) => item.contract_id === contract.id);
        return <article className="correction-card" key={contract.id}><h3>{contract.client_name}</h3>
          <p>{contract.origin} · {formatDateBR(contract.contract_date)}</p>
          <FieldCorrection table="clients" recordId={contract.client_id} field="full_name"
            current={contract.client_name} label="Nome do cliente" />
          <FieldCorrection table="clients" recordId={contract.client_id} field="cpf"
            current={contract.client_cpf ?? ""} label="CPF" />
          <FieldCorrection table="contracts" recordId={contract.id} field="origin"
            current={contract.origin} label="Origem" options={["Cliente próprio", "Propriedade Intelectual", "Tráfego HP"]
              .map((item) => ({ value: item, label: item }))} />
          <FieldCorrection table="contracts" recordId={contract.id} field="contract_date"
            current={contract.contract_date} label="Data do contrato" />
          {data.contractTotals.find((item) => item.id === contract.id) &&
            <FieldCorrection table="contracts" recordId={contract.id} field="total_contract_value"
              current={String(data.contractTotals.find((item) => item.id === contract.id)?.total_contract_value)}
              label="Valor do contrato" />}
          {term && <FieldCorrection table="contract_financial_terms" recordId={contract.id}
            field="commission_percentage" current={String(term.commission_percentage)} label="Percentual"
            options={[5,10,15,20,25,30,35,40,45,50,55,60].map((item) =>
              ({ value: String(item), label: `${item}%` }))} />}
          {contract.installments.map((item) => <div key={item.id}>
            <p>Parcela {item.installment_number} · {formatDateBR(item.due_date)}</p>
            <LatePaymentForm installmentId={item.id} />
            <FieldCorrection table="installments" recordId={item.id} field="due_date"
              current={item.due_date} label="Vencimento" />
            <FieldCorrection table="installments" recordId={item.id} field="contractual_amount"
              current={String(item.contractual_amount)} label="Valor contratual da parcela" />
          </div>)}
          <AuditDetails entries={data.audit.filter((entry) =>
            entry.record_id === contract.id || entry.record_id === contract.client_id ||
            contract.installments.some((item) => item.id === entry.record_id))} users={data.users} />
        </article>;
      })}</div>
    </section>}

    <section className="workspace-panel"><h2>Fechamentos</h2>
      {lawyerId && !selectedClosing && <ClosingPreview lawyerId={lawyerId} month={Number(month)}
        year={Number(year)} rows={previewRows} today={today} />}
      {!periodClosings.length && !lawyerId && <p>Nenhum fechamento realizado neste período.</p>}
      <div className="closing-list">{periodClosings.map((closing) => {
        const deadline = transferDeadline(closing.closed_at, Math.round(closing.amount_pending_transfer * 100), today);
        const lawyer = data.lawyers.find((item) => item.id === closing.lawyer_id);
        const transfers = data.transfers.filter((item) => item.closing_id === closing.id);
        const adjustments = data.adjustments.filter((item) => item.closing_id === closing.id);
        const items = data.items.filter((item) => item.closing_id === closing.id);
        return <article className="closing-card" key={closing.id}>
          <h3>{lawyer?.full_name ?? "Advogada"} · {months[closing.reference_month - 1]}/{closing.reference_year}</h3>
          <p>{closingStatus[closing.status]}{deadline && ` · ${deadline.label}`}
            {closing.closed_at && ` · Fechado em ${new Date(closing.closed_at).toLocaleDateString("pt-BR")}`}</p>
          <div className="closing-totals"><span>Escritório: {formatBRL(closing.office_amount_received)}</span>
            <span>Comissão original: {formatBRL(closing.commission_amount)}</span>
            <span>Repassado: {formatBRL(closing.amount_already_transferred)}</span>
            <strong>Saldo: {formatBRL(closing.amount_pending_transfer)}</strong></div>
          {adjustments.length > 0 && <p className="adjustment-notice">Corrigido após fechamento · Ajuste de comissão: {formatBRL(closing.adjustment_amount)}
            {closing.amount_overpaid > 0 && ` · Excesso a regularizar: ${formatBRL(closing.amount_overpaid)}`}</p>}
          <details className="operation-details"><summary>Ver composição original ({items.length})</summary>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Cliente</th><th>Recebido</th>
              <th>Data</th><th>%</th><th>Comissão</th></tr></thead><tbody>{items.map((item) => {
                return <tr key={item.id}><td>{item.client_name}</td>
                  <td>{formatBRL(item.amount_received)}</td><td>{formatDateBR(item.payment_date)}</td>
                  <td>{item.commission_percentage}%</td><td>{formatBRL(item.commission_amount)}</td></tr>;
              })}</tbody></table></div></details>
          {adjustments.length > 0 && <details className="operation-details"><summary>Ver ajustes posteriores ({adjustments.length})</summary>
            <ul className="audit-list">{adjustments.map((item) => <li key={item.id}>
              {new Date(item.created_at).toLocaleString("pt-BR")} · Escritório: {formatBRL(item.office_delta)} ·
              Comissão: {formatBRL(item.commission_delta)} · {item.reason}</li>)}</ul>
          </details>}
          <TransferForm closing={closing} />
          <details className="operation-details"><summary>Repasses ({transfers.filter((item) => !item.reversed_at).length})</summary>
            {transfers.length ? <ul className="audit-list">{transfers.map((item) => <li key={item.id}>
              {formatBRL(item.amount)} · {formatDateBR(item.payment_date)} · {item.notes || "Sem observação"}
              {item.reversed_at ? <span>Revertido: {item.reversal_reason}</span> : <ReverseTransferForm id={item.id} />}
            </li>)}</ul> : <p>Nenhum repasse registrado.</p>}
          </details>
        </article>;
      })}</div>
    </section>

    <section className="workspace-panel"><h2>Inadimplência</h2>
      {delinquency.length ? <div className="table-scroll"><table className="data-table"><thead><tr>
        <th>Cliente</th><th>Advogada</th><th>Primeira parcela vencida</th><th>Parcelas</th>
        <th>Saldo contratual vencido</th><th>Participação potencial</th><th>Última cobrança</th>
      </tr></thead><tbody>{delinquency.map((row) => <tr key={`${row.clientId}:${row.lawyerId}`}>
        <td>{row.clientName}</td><td>{row.lawyerName}</td><td>{formatDateBR(row.firstDueDate)}</td>
        <td>{row.installmentCount}</td><td>{money(row.balanceCents)}</td>
        <td>{money(row.potentialCents)} <small>estimativa, não comissão gerada</small></td>
        <td>{row.latestContactAt ? new Date(row.latestContactAt).toLocaleDateString("pt-BR") : "Sem cobrança"}</td>
      </tr>)}</tbody></table></div> : <p>Nenhuma parcela inadimplente no filtro atual.</p>}
    </section>

    {lawyerId && <section className="workspace-panel"><h2>Notas e correções</h2>
      {data.notes.filter((note) => data.contracts.some((contract) =>
        contract.lawyer_id === lawyerId && contract.client_id === note.client_id)).map((note) =>
        <article key={note.id} className="correction-card"><p>{note.author_name} · {new Date(note.created_at).toLocaleString("pt-BR")}</p>
          <p>{note.content}</p><FieldCorrection table="collection_notes" recordId={note.id}
            field="content" current={note.content} label="Anotação" />
          <FieldCorrection table="collection_notes" recordId={note.id} field="note_type"
            current={note.note_type} label="Tipo da anotação" options={[
              { value: "collection", label: "Cobrança" }, { value: "client_reply", label: "Retorno do cliente" },
              { value: "renegotiation", label: "Renegociação" }, { value: "general", label: "Informação geral" },
            ]} />
          <AuditDetails entries={data.audit.filter((entry) => entry.table_name === "collection_notes" && entry.record_id === note.id)} users={data.users} />
        </article>)}
    </section>}
  </>;
}
