import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContract } from "@/lib/contracts/data";
import { buildFinancialRows, statusLabels, todayInSaoPaulo } from "@/lib/contracts/view";
import { numericToCents, participationCents } from "@/lib/contracts/finance";
import { formatCpf } from "@/lib/contracts/validation";
import { formatBRL, formatDateBR } from "@/lib/formatters";

export default async function ContractDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criado?: string }>;
}) {
  const profile = await requireRole("lawyer");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const contract = await loadLawyerContract(profile.id, id);
  if (!contract) notFound();
  const { criado } = await searchParams;
  const rows = buildFinancialRows([contract], todayInSaoPaulo());
  const totalCents = numericToCents(contract.total_contract_value);
  const paymentRows = contract.installments.flatMap((item) => item.payments.map((payment) => ({
    ...payment, installmentLabel: rows.find((row) => row.installmentId === item.id)?.installmentLabel ?? "—",
  }))).sort((a, b) => b.payment_date.localeCompare(a.payment_date));

  return <DashboardShell profile={profile}>
    <Link className="back-link" href="/advogada">← Voltar ao painel</Link>
    {criado === "1" && <div className="success-box" role="status">Contrato cadastrado com sucesso.</div>}
    <p className="eyebrow">DETALHES DO CONTRATO</p><h1>{contract.client_name}</h1>
    <p className="page-description">Dados gerais, documento e cronograma financeiro.</p>
    <div className="detail-grid"><section className="form-panel"><h2>Dados gerais</h2>
      <dl className="review-grid"><div><dt>Cliente</dt><dd>{contract.client_name}</dd></div>
        <div><dt>CPF</dt><dd>{contract.client_cpf ? formatCpf(contract.client_cpf) : "—"}</dd></div>
        <div><dt>Origem</dt><dd>{contract.origin}</dd></div>
        <div><dt>Data do contrato</dt><dd>{formatDateBR(contract.contract_date)}</dd></div>
        <div><dt>Valor contratado</dt><dd>{formatBRL(totalCents / 100)}</dd></div>
        <div><dt>Minha participação</dt><dd>{contract.commission_percentage}%</dd></div>
        <div><dt>Participação contratual estimada</dt><dd>{formatBRL(participationCents(totalCents, contract.commission_percentage) / 100)}</dd></div>
        <div><dt>Forma de pagamento</dt><dd>{contract.payment_method === "cash" ? "À vista" :
          contract.payment_method === "installments" ? "Parcelado" : "Não informada"}</dd></div>
        {contract.payment_start_type === "condition" && <div><dt>Início dos pagamentos</dt>
          <dd>{contract.payment_start_condition}</dd></div>}
        {contract.last_installment_amount != null && <div><dt>Última parcela contratada</dt>
          <dd>{formatBRL(contract.last_installment_amount)}</dd></div>}
        {contract.has_additional_fee && <div><dt>Honorários adicionais eventuais</dt>
          <dd>{contract.additional_fee_percentage == null ? "Percentual não informado" :
            `${contract.additional_fee_percentage}%`} sobre {
            contract.additional_fee_basis ?? "base não informada"} · {
            contract.additional_fee_amount == null ? "valor ainda não informado" :
              formatBRL(contract.additional_fee_amount)}</dd></div>}
      </dl></section>
      <section className="form-panel document-panel"><h2>Documento</h2>
        <p>{contract.contract_file_name ?? "Nenhum PDF anexado a este contrato."}</p>
        {contract.contract_file_path && <a className="secondary-button" target="_blank" rel="noopener noreferrer"
          href={`/advogada/contratos/${contract.id}/pdf`}>Visualizar contrato</a>}
        <small>O acesso ao PDF é temporário e protegido.</small>
      </section></div>
    <section className="table-section detail-table"><div className="section-heading"><div>
      <p className="eyebrow">CRONOGRAMA</p><h2>Parcelas e recebimentos</h2>
      <p>Pagamentos são lançados pela secretaria. Esta página é somente para consulta.</p>
    </div></div>
      {rows.length === 0 ? <div className="empty-state"><p>{contract.payment_start_type === "condition" ?
        "Aguardando definição do primeiro vencimento." : "Nenhuma parcela cadastrada."}</p></div> :
      <div className="table-scroll"><table className="financial-table"><thead><tr><th>Parcela</th>
        <th>Vencimento</th><th>Valor contratual</th><th>Valor pago</th><th>Diferença</th><th>Data do pagamento</th>
        <th>Participação estimada</th><th>Comissão efetiva</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.installmentId}><td>{row.installmentLabel}</td>
          <td>{formatDateBR(row.dueDate)}</td><td className="money-cell">{formatBRL(row.contractualCents / 100)}</td>
          <td className="money-cell">{row.paidCents === null ? "—" : formatBRL(row.paidCents / 100)}</td>
          <td className="money-cell">{row.differenceCents === null ? "—" : formatBRL(row.differenceCents / 100)}</td>
          <td>{row.latestPaymentDate ? formatDateBR(row.latestPaymentDate) : "—"}</td>
          <td className="money-cell">{formatBRL(row.estimatedCents / 100)}</td>
          <td className="money-cell">{row.commissionCents === null ? "—" : formatBRL(row.commissionCents / 100)}</td>
          <td><span className={`status status-${row.status}`}>{statusLabels[row.status]}</span></td>
        </tr>)}</tbody></table></div>}
    </section>
    <section className="table-section detail-table"><div className="section-heading"><div>
      <p className="eyebrow">HISTÓRICO</p><h2>Pagamentos registrados</h2>
      <p>Cada recebimento é mostrado separadamente, inclusive pagamentos parciais.</p>
    </div></div>
      {paymentRows.length === 0 ? <div className="empty-state"><p>Nenhum pagamento registrado até agora.</p></div> :
      <div className="table-scroll"><table className="financial-table"><thead><tr>
        <th>Parcela</th><th>Data do pagamento</th><th>Valor efetivamente pago</th><th>Comissão gerada</th><th>Situação</th>
      </tr></thead><tbody>{paymentRows.map((payment) => <tr key={payment.id}>
        <td>{payment.installmentLabel}</td><td>{formatDateBR(payment.payment_date)}</td>
        <td className="money-cell">{formatBRL(Number(payment.amount_paid))}</td>
        <td className="money-cell">{payment.voided_at ? "—" : formatBRL(payment.commissions ? Number(payment.commissions.commission_amount) :
          participationCents(numericToCents(payment.amount_paid), contract.commission_percentage) / 100)}</td>
        <td>{payment.voided_at ? "Estornado" : "Ativo"}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </DashboardShell>;
}
