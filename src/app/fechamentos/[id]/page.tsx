import Link from "next/link";
import {randomUUID} from "node:crypto";
import {IssuePayoutReport} from "@/components/payout-receipt-forms";
import {notFound,redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {ClosingCorrectionForm} from "@/components/closing-correction-form";
import {DownloadReport} from "@/components/reports/download-report";
import {RepassumLogo} from "@/components/brand";
import {requireActiveProfile} from "@/lib/auth/profile";
import {loadClosings} from "@/lib/finance/data";
import {loadLawyerContracts} from "@/lib/contracts/data";
import {buildLawyerFinancialRows,todayInSaoPaulo} from "@/lib/contracts/view";
import {loadClosedReport} from "@/lib/reports/data";
import {formatBRL,formatDateBR} from "@/lib/formatters";
import {isReportId} from "@/lib/reports/model";
import {closingOriginsQuery,parseClosingOrigins} from "@/lib/reports/closing-filters";
import {ClosingReportFilters} from "@/components/reports/closing-report-filters";
import {LegacyPayoutLinks} from "@/components/payout-agenda";
import {loadPayoutAgenda} from "@/lib/finance/payouts";

export default async function ClosedMonthPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const profile=await requireActiveProfile();
  if(!["lawyer","manager"].includes(profile.role)) redirect("/app");
  const {id}=await params;if(!isReportId(id)) notFound();
  const query=new URLSearchParams();for(const [key,value] of Object.entries(await searchParams))for(const item of Array.isArray(value)?value:value?[value]:[])query.append(key,item);
  const origins=parseClosingOrigins(query),normalized=closingOriginsQuery(origins);
  const closing=(await loadClosings(profile.role==="lawyer"?profile.id:undefined)).find(c=>c.id===id);
  if(!closing||closing.status==="draft"||!closing.closed_at) notFound();
  const [report,contracts,agenda]=await Promise.all([loadClosedReport(profile,id,origins),origins.length?Promise.resolve([]):loadLawyerContracts(closing.lawyer_id),
    profile.role==="manager"?loadPayoutAgenda(id):Promise.resolve(null)]);
  const month=`${closing.reference_year}-${String(closing.reference_month).padStart(2,"0")}`;
  const personalIds=profile.role==="lawyer"?new Set(buildLawyerFinancialRows(contracts,todayInSaoPaulo()).map(row=>row.installmentId)):null;
  const installments=contracts.flatMap(c=>c.installments.filter(i=>!personalIds||personalIds.has(i.id)).map(i=>({id:i.id,label:`${c.client_name} · ${c.service_name||c.origin} · parcela ${i.installment_number} · ${formatBRL(i.contractual_amount)}`})));
  const payments=contracts.flatMap(c=>c.installments.filter(i=>!personalIds||personalIds.has(i.id)).flatMap(i=>i.payments.filter(p=>!p.voided_at&&p.payment_date.startsWith(month)).map(p=>({id:p.id,
    label:`${c.client_name} · parcela ${i.installment_number} · ${formatDateBR(p.payment_date)} · ${formatBRL(p.amount_paid)}`}))));
  return <DashboardShell profile={profile}>
    <Link href={profile.role==="lawyer"?"/advogada/fechamentos":"/gestor#fechamentos"}>← Voltar aos fechamentos</Link>
    <h1>Fechamento · {report.period}</h1>
    <ClosingReportFilters id={id} origins={origins}/>
    <section className="workspace-panel"><RepassumLogo/><h2>{report.officeName} · {report.audience}</h2>
      <p>{report.subtitle}</p>{profile.role==="lawyer"?<IssuePayoutReport key={normalized} closing={id} origins={origins} request={randomUUID()}/>:
        <DownloadReport href={`/relatorios/fechamentos/${id}/pdf${normalized?`?${normalized}`:""}`}/>}
      <div className="card-grid">{report.metrics.map(m=><article className="financial-card" key={m.label}><h3>{m.label}</h3><strong>{m.value}</strong><p>{m.hint}</p></article>)}</div>
      {report.sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.rows.length?<div className="table-scroll"><table className="data-table">
        <thead><tr>{s.columns.map(c=><th key={c.label}>{c.label}</th>)}</tr></thead><tbody>{s.rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} style={{whiteSpace:"pre-line"}}>{v}</td>)}</tr>)}</tbody>
      </table></div>:<p>{s.empty}</p>}</section>)}
      {report.notes.map(n=><p key={n}>{n}</p>)}
    </section>{agenda&&<LegacyPayoutLinks agenda={agenda}/>}{origins.length>0?<p>Este é um recorte para conferência. Para corrigir lançamentos, <Link href={`/fechamentos/${id}`}>abra o fechamento completo</Link>.</p>:<ClosingCorrectionForm closing={id} payments={payments} installments={installments}/>}
  </DashboardShell>;
}
