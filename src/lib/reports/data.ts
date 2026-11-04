import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentProfile } from "@/lib/auth/profile";
import { numericToCents } from "@/lib/contracts/finance";
import { ReportError, isReportId, operationalDocument, reportScope, type ReportFilters, type OperationalReportRow } from "./model";
import { closingDocument, type ClosedReportData } from "./closing";

function reportFailure(error: { code?: string; message: string }): never {
  if (error.code === "PGRST202") throw new ReportError("O módulo de relatórios aguarda a atualização do banco. Peça ao administrador para aplicar a migration de relatórios.", 503);
  if (error.code === "42501") throw new ReportError("Você não tem permissão para consultar esses dados.", 403);
  if (error.code === "P0002") throw new ReportError("Fechamento indisponível para este usuário.", 404);
  if (["22023", "54000"].includes(error.code ?? "")) throw new ReportError(error.message, error.code === "54000" ? 413 : 422);
  throw new ReportError("Não foi possível consultar os dados do relatório. Tente novamente.", 503);
}
export async function reportLawyers(profile: CurrentProfile) {
  if (profile.role === "lawyer") return [{ id: profile.id, full_name: profile.full_name }];
  const supabase = await createClient();
  const lawyers: { id: string; full_name: string }[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("profiles").select("id,full_name").eq("office_id", profile.office_id)
      .eq("role", "lawyer").order("full_name").order("id").range(offset, offset + 199);
    if (error) reportFailure(error);
    lawyers.push(...(data ?? []));
    if (!data || data.length < 200) return lawyers;
  }
}
export async function loadOperationalReport(profile: CurrentProfile, filters: ReportFilters) {
  const scope = reportScope(profile, filters.lawyerId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("filtered_activity_report", { p_kind: filters.kind, p_from: filters.from, p_to: filters.to,
    p_lawyer: scope.lawyerId, p_client: filters.client, p_cpf: filters.cpf, p_origin: filters.origin, p_service: filters.service, p_status: filters.status });
  if (error) reportFailure(error);
  const payload = data as { rows: OperationalReportRow[]; as_of: string; issued_at: string; commissions?: { payment_id: string; amount: number }[] };
  if (!payload || !Array.isArray(payload.rows)) throw new ReportError("Relatório indisponível.", 503);
  const rows = payload.rows;
  const commissions = new Map<string, number>();
  if (scope.financial && filters.kind === "payments") {
    if (!Array.isArray(payload.commissions)) throw new ReportError("As comissões do relatório estão indisponíveis.", 503);
    for (const item of payload.commissions) commissions.set(item.payment_id, numericToCents(item.amount));
  }
  const { data: office, error: officeError } = await supabase.from("offices").select("name").eq("id", scope.officeId).single();
  if (officeError || !office) throw new ReportError("Não foi possível identificar o escritório do relatório.", 503);
  let lawyerName: string | undefined;
  if (profile.role === "lawyer") lawyerName = profile.full_name;
  else if (scope.lawyerId) {
    const { data: lawyer, error: lawyerError } = await supabase.from("profiles").select("full_name").eq("id", scope.lawyerId).eq("office_id", scope.officeId).eq("role", "lawyer").maybeSingle();
    if (lawyerError) reportFailure(lawyerError);
    if (!lawyer) throw new ReportError("Advogada indisponível neste escritório.", 404);
    lawyerName = lawyer.full_name;
  }
  return operationalDocument(rows, filters, scope, { officeName: office.name, lawyerName, issuedBy: profile.full_name,
    issuedAt: payload.issued_at, today: payload.as_of }, commissions);
}
export async function loadClosedReport(profile: CurrentProfile, id: string) {
  const scope = reportScope(profile);
  if (!scope.financial) throw new ReportError("Seu perfil permite emitir apenas relatórios operacionais.", 403);
  if (!isReportId(id)) throw new ReportError("Fechamento inválido.", 404);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("closed_month_report", { p_closing: id });
  if (error) reportFailure(error);
  const payload = data as ClosedReportData;
  if (!payload?.closing || !payload.office_name || !payload.lawyer_name) throw new ReportError("Fechamento indisponível.", 404);
  return { ...closingDocument(payload, profile.full_name, (data as { issued_at: string }).issued_at), payoutAgenda: payload.payout_agenda };
}
