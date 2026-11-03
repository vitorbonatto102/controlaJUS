import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ReportFiltersForm } from "@/components/reports/report-filters";
import { ReportPreview } from "@/components/reports/report-preview";
import { requireActiveProfile } from "@/lib/auth/profile";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { formatDateBR } from "@/lib/formatters";
import { loadOperationalReport, reportLawyers } from "@/lib/reports/data";
import { parseReportFilters, reportQuery, reportScope, ReportError, type ReportDocument } from "@/lib/reports/model";
import styles from "@/components/reports/reports.module.css";

export const metadata: Metadata = { title: "Relatórios" };
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile(), today = todayInSaoPaulo();
  const query = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : value ? [value] : []) params.append(key, item);
  let filters = parseReportFilters(new URLSearchParams(), today), report: ReportDocument | null = null, error: string | null = null;
  const scope = reportScope(profile);
  let lawyers: { id: string; full_name: string }[] = [];
  try {
    filters = parseReportFilters(params, today); reportScope(profile, filters.lawyerId);
    [report, lawyers] = await Promise.all([loadOperationalReport(profile, filters), reportLawyers(profile)]);
  } catch (cause) { error = cause instanceof ReportError ? cause.message : "O relatório não pôde ser consultado. Tente novamente."; }
  const normalized = reportQuery(filters), pageValue = params.get("pagina") ?? "1";
  const page = /^\d{1,5}$/.test(pageValue) ? Math.max(1, Number(pageValue)) : 1;
  return <DashboardShell profile={profile}><div className={styles.page}>
    <header className={styles.heading}><h1>Relatórios</h1><p>Escolha o período e os filtros, confira a prévia e emita um PDF com os registros selecionados.
      {profile.role === "lawyer" ? " Todos os relatórios ficam limitados à sua própria carteira." : profile.role === "secretary" ? " Seu acesso inclui os dados operacionais do escritório." : " Acompanhe os registros de todas as advogadas do seu escritório."}</p></header>
    <ReportFiltersForm key={params.toString()} filters={filters} lawyers={lawyers} canSelectLawyer={scope.canSelectLawyer}
      dateValues={error ? { from: params.get("de") ?? formatDateBR(filters.from), to: params.get("ate") ?? formatDateBR(filters.to) } : undefined} />
    {error && <p className={styles.error} role="alert">{error}</p>}
    {report && <ReportPreview report={report} pdfHref={`/relatorios/pdf?${normalized}`} page={page}
      pageHref={number => `/relatorios?${normalized}&pagina=${number}`} />}
    {scope.financial && <section className={styles.closingHelp}><h2>Relatório de mês fechado</h2>
      <p>Os fechamentos confirmados têm um documento próprio com a composição original, ajustes e repasses. Ele representa o fechamento completo, sem recortes por cliente.</p>
      <Link href={profile.role === "lawyer" ? "/advogada/fechamentos" : "/gestor#fechamentos"}>Abrir fechamentos →</Link></section>}
  </div></DashboardShell>;
}
