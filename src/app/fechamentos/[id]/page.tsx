import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {ClosingCorrectionForm} from "@/components/closing-correction-form";
import {DownloadReport} from "@/components/reports/download-report";
import {RepassumLogo} from "@/components/brand";
import {requireActiveProfile} from "@/lib/auth/profile";
import {loadClosings} from "@/lib/finance/data";
import {loadLawyerContracts} from "@/lib/contracts/data";
import {loadClosedReport} from "@/lib/reports/data";
import {formatBRL,formatDateBR} from "@/lib/formatters";
import {isReportId} from "@/lib/reports/model";

export default async function ClosedMonthPage({params}:{params:Promise<{id:string}>}) {
  const profile=await requireActiveProfile();
  if(!["lawyer","manager"].includes(profile.role)) redirect("/app");
  const {id}=await params;if(!isReportId(id)) notFound();
  const closing=(await loadClosings(profile.role==="lawyer"?profile.id:undefined)).find(c=>c.id===id);
  if(!closing||closing.status==="draft"||!closing.closed_at) notFound();
  const [report,contracts]=await Promise.all([loadClosedReport(profile,id),loadLawyerContracts(closing.lawyer_id)]);
  const month=`${closing.reference_year}-${String(closing.reference_month).padStart(2,"0")}`;
  const installments=contracts.flatMap(c=>c.installments.map(i=>({id:i.id,label:`${c.client_name} · ${c.service_name||c.origin} · parcela ${i.installment_number} · ${formatBRL(i.contractual_amount)}`})));
  const payments=contracts.flatMap(c=>c.installments.flatMap(i=>i.payments.filter(p=>!p.voided_at&&p.payment_date.startsWith(month)).map(p=>({id:p.id,
    label:`${c.client_name} · parcela ${i.installment_number} · ${formatDateBR(p.payment_date)} · ${formatBRL(p.amount_paid)}`}))));
  return <DashboardShell profile={profile}>
    <Link href={profile.role==="lawyer"?"/advogada/fechamentos":"/gestor#fechamentos"}>← Voltar aos fechamentos</Link>
    <h1>Fechamento · {report.period}</h1>
    <section className="workspace-panel"><RepassumLogo/><h2>{report.officeName} · {report.audience}</h2>
      <p>{report.subtitle}</p><DownloadReport href={`/relatorios/fechamentos/${id}/pdf`}/>
      <div className="card-grid">{report.metrics.map(m=><article className="financial-card" key={m.label}><h3>{m.label}</h3><strong>{m.value}</strong><p>{m.hint}</p></article>)}</div>
      {report.sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.rows.length?<div className="table-scroll"><table className="data-table">
        <thead><tr>{s.columns.map(c=><th key={c.label}>{c.label}</th>)}</tr></thead><tbody>{s.rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} style={{whiteSpace:"pre-line"}}>{v}</td>)}</tr>)}</tbody>
      </table></div>:<p>{s.empty}</p>}</section>)}
      {report.notes.map(n=><p key={n}>{n}</p>)}
    </section><ClosingCorrectionForm closing={id} payments={payments} installments={installments}/>
  </DashboardShell>;
}
