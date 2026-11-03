import { loadClosedReport } from "@/lib/reports/data";
import { reportProfile, pdfResponse, reportErrorResponse } from "@/lib/reports/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await reportProfile(), { id } = await params;
    const report = await loadClosedReport(profile, id);
    const [month, year] = report.period.split("/");
    return await pdfResponse(report, `repassum-fechamento-${year}-${month}-${id.slice(0, 8)}.pdf`);
  } catch (error) { return reportErrorResponse(error); }
}
