import { loadClosedReport } from "@/lib/reports/data";
import { reportProfile, pdfResponse, reportErrorResponse } from "@/lib/reports/http";
import {parseClosingOrigins} from "@/lib/reports/closing-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await reportProfile(), { id } = await params;
    const origins=parseClosingOrigins(new URL(request.url).searchParams);
    const report = await loadClosedReport(profile, id,origins);
    const [month, year] = report.period.split("/");
    return await pdfResponse(report, `repassum-fechamento-${year}-${month}-${id.slice(0, 8)}${origins.length?"-por-origem":""}.pdf`);
  } catch (error) { return reportErrorResponse(error); }
}
