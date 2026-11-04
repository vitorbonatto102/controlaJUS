import {randomUUID} from "node:crypto";
import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {ReportPreview} from "@/components/reports/report-preview";
import {ConfirmPayoutReceipt,ReverseOwnReceipt} from "@/components/payout-receipt-forms";
import {requireActiveProfile} from "@/lib/auth/profile";
import {loadPayoutReport} from "@/lib/finance/payout-report-data";
import {payoutReportDocument} from "@/lib/finance/payout-report-model";
import {closingOriginsQuery} from "@/lib/reports/closing-filters";
import {ReportError} from "@/lib/reports/model";
import {formatBRL,formatDateBR} from "@/lib/formatters";

export default async function PayoutReportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{confirmado?:string;corrigido?:string}>}){
  const profile=await requireActiveProfile();if(!["lawyer","manager"].includes(profile.role))redirect("/app");
  const {id}=await params;let record;
  try{record=await loadPayoutReport(profile,id);}catch(error){if(error instanceof ReportError&&error.status===404)notFound();throw error;}
  const query=await searchParams,document=payoutReportDocument(record),origins=closingOriginsQuery(record.origins);
  const closingUrl=`/fechamentos/${record.closing_id}${origins?`?${origins}`:""}`,own=profile.role==="lawyer";
  return <DashboardShell profile={profile}>
    <Link href={own?"/advogada/fechamentos":"/gestor#fechamentos"}>← Voltar aos fechamentos</Link>
    <h1>{own?"Meu relatório para repasse":"Relatório para repasse"}</h1><p>{document.audience} · {document.period} · Emitido em {formatDateBR(new Date(record.created_at))}</p>
    {query.confirmado==="1"&&<div role="status" className="success-box">Recebimento confirmado. O saldo foi atualizado e o gestor foi avisado.</div>}
    {query.corrigido==="1"&&<div role="status" className="success-box">Confirmação desfeita com histórico. O gestor foi avisado; você pode registrar os dados corretos.</div>}
    <ReportPreview report={document} pdfHref={`/repasses/${id}/pdf`}/>
    <section className="workspace-panel"><h2>Posição atual do recebimento</h2>
      <p>Saldo disponível para confirmar agora: <strong>{record.stale||record.availability_error?"Revisão necessária":formatBRL(record.available_cents/100)}</strong></p>
      {record.availability_error?<p role="alert">{record.availability_error}</p>:record.stale?<p>O fechamento foi corrigido depois da emissão. <Link href={closingUrl}>Emita um relatório atualizado</Link> antes de confirmar outro valor.</p>:
        record.available_cents===0?<p>Não há saldo adicional disponível neste relatório. Os valores já atendidos permanecem no histórico.</p>:null}
      <p>O PDF preserva os valores da emissão. Esta posição considera as confirmações posteriores, inclusive as vinculadas a outros relatórios do mesmo fechamento.</p>
    </section>
    {own&&!record.stale&&!record.availability_error&&record.available_cents>0&&<ConfirmPayoutReceipt key={`${record.receipts.length}:${record.available_cents}`} report={id} request={randomUUID()} available={record.available_cents}/>}
    {!own&&<p>A confirmação é feita pela advogada após receber o dinheiro. O gestor acompanha este histórico sem precisar aprovar o registro.</p>}
    <section className="workspace-panel"><h2>Recebimentos confirmados neste relatório</h2>
      {record.receipts.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>Data do recebimento</th><th>Valor</th><th>Situação</th><th>Observação</th>{own&&<th>Ações</th>}</tr></thead>
        <tbody>{record.receipts.map(receipt=><tr key={receipt.id}><td>{formatDateBR(receipt.payment_date)}</td><td>{formatBRL(Number(receipt.amount))}</td>
          <td>{receipt.reversed_at?`Desfeita: ${receipt.reversal_reason}`:"Confirmado pela advogada"}</td><td>{receipt.notes||"—"}</td>
          {own&&<td>{!receipt.reversed_at&&<ReverseOwnReceipt report={id} transfer={receipt.id}/>}</td>}</tr>)}</tbody></table></div>:<p>Nenhum recebimento confirmado neste relatório.</p>}
    </section>
    <details className="workspace-panel"><summary>Ver a composição e as participações do relatório emitido</summary>
      {document.sections.slice(1).map(section=><section key={section.title}><h2>{section.title}</h2><div className="table-scroll"><table className="data-table"><thead><tr>{section.columns.map(c=><th key={c.label}>{c.label}</th>)}</tr></thead>
        <tbody>{section.rows.map((cells,i)=><tr key={i}>{cells.map((cell,j)=><td key={j} style={{whiteSpace:"pre-line"}}>{cell}</td>)}</tr>)}</tbody></table></div></section>)}
    </details><p><Link href={closingUrl}>Consultar o fechamento e emitir outro relatório</Link></p>
  </DashboardShell>;
}
