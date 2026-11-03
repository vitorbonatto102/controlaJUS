import "server-only";
import { getCurrentProfile } from "@/lib/auth/profile";
import { ReportError, reportScope, type ReportDocument } from "./model";
import { renderReportPdf } from "./pdf";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export async function reportProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new ReportError("Sua sessão expirou. Entre novamente para emitir o relatório.", 401);
  reportScope(profile); return profile;
}
export async function pdfResponse(report: ReportDocument, filename: string, landscape = false) {
  const bytes = await renderReportPdf(report, landscape);
  return new Response(new Uint8Array(bytes).buffer, { headers: { ...privateHeaders, "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"` } });
}
export function reportErrorResponse(error: unknown) {
  return Response.json({ error: error instanceof ReportError ? error.message : "Não foi possível gerar o PDF. Tente novamente." },
    { status: error instanceof ReportError ? error.status : 503, headers: privateHeaders });
}
