import { todayInSaoPaulo } from "@/lib/contracts/view";
import { parseReportFilters } from "@/lib/reports/model";
import { loadOperationalReport } from "@/lib/reports/data";
import { reportProfile, pdfResponse, reportErrorResponse } from "@/lib/reports/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const profile = await reportProfile(), filters = parseReportFilters(new URL(request.url).searchParams, todayInSaoPaulo());
    const report = await loadOperationalReport(profile, filters);
    const names = { payments: "recebimentos", installments: "parcelas", contracts: "contratos" };
    return await pdfResponse(report, `repassum-${names[filters.kind]}-${filters.from}-${filters.to}.pdf`, filters.kind === "installments");
  } catch (error) { return reportErrorResponse(error); }
}
