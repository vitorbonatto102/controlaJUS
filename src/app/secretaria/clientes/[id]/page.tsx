import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { NoteForm, PaymentCorrectionForm, PaymentForm } from "@/components/secretary-forms";
import { requireRole } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { formatCpf } from "@/lib/contracts/validation";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { loadSecretaryWorkspace } from "@/lib/secretary/data";
import { buildOperationalRows, noteTypeLabels, operationalStatusLabels } from "@/lib/secretary/view";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientOperationPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("secretary");
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const { contracts: allContracts, notes: allNotes, users } = await loadSecretaryWorkspace();
  const contracts = allContracts.filter((contract) => contract.client_id === id);
  if (!contracts.length) notFound();
  const notes = allNotes.filter((note) => note.client_id === id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rows = buildOperationalRows(contracts, notes, todayInSaoPaulo());
  const paymentRows = contracts.flatMap((contract) => contract.installments.flatMap((item) => item.payments.map(
    (payment) => ({ ...payment, row: rows.find((row) => row.installmentId === item.id),
      contractId: contract.id })))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const names = new Map(users.map((user) => [user.id, user.full_name]));
  const client = contracts[0];
  return <DashboardShell profile={profile}>
    <Link className="back-link" href="/secretaria">← Voltar ao painel</Link>
    <p className="eyebrow">CLIENTE</p><h1>{client.client_name}</h1>
    <p className="page-description">Contratos, parcelas, pagamentos e histórico de cobrança.</p>
    <section className="form-panel secretary-client-summary"><h2>Dados básicos</h2>
      <dl className="review-grid"><div><dt>CPF</dt><dd>{client.client_cpf ? formatCpf(client.client_cpf) : "—"}</dd></div>
        <div><dt>Advogada responsável</dt><dd>{[...new Set(contracts.map((contract) => contract.lawyer_name))].join(", ")}</dd></div></dl>
    </section>
    <section className="table-section"><div className="section-heading"><div><h2>Contratos</h2>
      <p>Vínculos operacionais deste cliente.</p></div></div>
      <div className="table-scroll"><table className="financial-table"><thead><tr><th>Advogada</th><th>Origem</th>
        <th>Data do contrato</th><th>Parcelas</th></tr></thead><tbody>{contracts.map((contract) => <tr key={contract.id}>
          <td>{contract.lawyer_name}</td><td>{contract.origin}</td><td>{formatDateBR(contract.contract_date)}</td>
          <td>{contract.installments.length}</td></tr>)}</tbody></table></div>
    </section>
    <section className="table-section"><div className="section-heading"><div><h2>Parcelas</h2>
      <p>Valor contratual e recebido são mantidos separadamente. É possível registrar vários pagamentos por parcela.</p></div></div>
      <div className="table-scroll"><table className="financial-table"><thead><tr><th>Advogada</th><th>Parcela</th>
        <th>Vencimento</th><th>Valor contratual</th><th>Recebido</th><th>Saldo</th><th>Status</th><th>Ação</th>
      </tr></thead><tbody>{rows.map((row) => <tr id={`parcela-${row.installmentId}`} key={row.installmentId}>
        <td>{row.lawyerName}</td><td>{row.installmentLabel}</td><td>{formatDateBR(row.dueDate)}</td>
        <td className="money-cell">{formatBRL(row.contractualCents / 100)}</td>
        <td className="money-cell">{formatBRL(row.paidCents / 100)}</td>
        <td className="money-cell">{formatBRL(row.balanceCents / 100)}</td>
        <td><span className={`status status-${row.status}`}>{operationalStatusLabels[row.status]}</span></td>
        <td><PaymentForm clientId={id} installmentId={row.installmentId} /></td>
      </tr>)}</tbody></table></div>
    </section>
    <section className="table-section"><div className="section-heading"><div><h2>Pagamentos</h2>
      <p>Correções preservam o lançamento original e exigem motivo. Apenas quem lançou pode corrigir.</p></div></div>
      {paymentRows.length === 0 ? <div className="empty-state"><p>Nenhum recebimento registrado.</p></div> :
        <div className="table-scroll"><table className="financial-table"><thead><tr><th>Parcela</th><th>Data</th>
          <th>Valor</th><th>Registrado por</th><th>Observação</th><th>Situação</th><th>Ação</th>
        </tr></thead><tbody>{paymentRows.map((payment) => <tr key={payment.id}>
          <td>{payment.row?.installmentLabel ?? "—"}</td><td>{formatDateBR(payment.payment_date)}</td>
          <td className="money-cell">{formatBRL(payment.amount_paid)}</td>
          <td>{names.get(payment.recorded_by) ?? "Usuário inativo"}</td><td>{payment.observation || "—"}</td>
          <td>{payment.voided_at ? <span className="status status-overdue">Estornado</span> :
            payment.replaces_payment_id ? <span className="status status-paid">Corrigido</span> : "Ativo"}
            {payment.void_reason && <small className="payment-reason">Motivo: {payment.void_reason}</small>}</td>
          <td>{!payment.voided_at && payment.recorded_by === profile.id ?
            <PaymentCorrectionForm clientId={id} paymentId={payment.id}
              amount={payment.amount_paid.toFixed(2).replace(".", ",")} date={payment.payment_date} /> : "—"}</td>
        </tr>)}</tbody></table></div>}
    </section>
    <section id="historico" className="table-section"><div className="section-heading"><div><h2>Histórico de cobrança</h2>
      <p>Cada contato permanece registrado na linha do tempo.</p></div></div>
      <div className="secretary-notes"><NoteForm clientId={id} contracts={contracts} />
        {notes.length === 0 ? <p className="muted-text">Nenhuma anotação registrada.</p> :
          <ol className="notes-timeline">{notes.map((note) => <li key={note.id}>
            <strong>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })
              .format(new Date(note.created_at))} · {noteTypeLabels[note.note_type] ?? note.note_type} · {note.author_name}</strong>
            <p>{note.content}</p></li>)}</ol>}
      </div>
    </section>
  </DashboardShell>;
}
