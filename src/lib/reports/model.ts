import type { CurrentProfile } from "@/lib/auth/profile";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { numericToCents } from "@/lib/contracts/finance";
import { ORIGINS, onlyDigits } from "@/lib/contracts/validation";
import { brazilianToIso } from "@/lib/contracts/registration";
import { operationalStatusLabels } from "@/lib/secretary/view";

export type ReportKind = "payments" | "installments" | "contracts";
export const reportLabels: Record<ReportKind, string> = { payments: "Recebimentos", installments: "Parcelas e saldos", contracts: "Contratos" };
export const reportStatuses = { all: "Todas", paid: "Pagas", open: "Em aberto", overdue: "Em atraso", partial: "Parcialmente pagas" };
export class ReportError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export type ReportScope = { officeId: string; lawyerId: string | null; financial: boolean; canSelectLawyer: boolean };
export function reportScope(profile: Pick<CurrentProfile, "id" | "role" | "office_id" | "active">, requested?: string): ReportScope {
  if (!profile.active || !profile.office_id) throw new ReportError("Seu acesso está pendente de ativação.", 403);
  if (!["lawyer", "secretary", "manager"].includes(profile.role)) throw new ReportError("Perfil sem acesso aos relatórios.", 403);
  if (profile.role === "lawyer" && requested && requested !== profile.id)
    throw new ReportError("Você pode emitir relatórios somente dos seus próprios dados.", 403);
  return { officeId: profile.office_id, lawyerId: profile.role === "lawyer" ? profile.id : requested || null,
    financial: profile.role !== "secretary", canSelectLawyer: profile.role !== "lawyer" };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isReportId = (value: string) => uuid.test(value);
export type ReportFilters = { kind: ReportKind; from: string; to: string; lawyerId: string; client: string;
  cpf: string; origin: string; service: string; status: keyof typeof reportStatuses };
export function parseReportFilters(params: URLSearchParams, today: string): ReportFilters {
  for (const key of ["tipo", "de", "ate", "advogada", "cliente", "cpf", "origem", "servico", "situacao"])
    if (params.getAll(key).length > 1) throw new ReportError("Há filtros repetidos. Limpe os filtros e tente novamente.");
  const month = today.slice(0, 7), [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const read = (key: string) => (params.get(key) ?? "").trim();
  let from: string, to: string;
  try { from = read("de") ? brazilianToIso(read("de")) : `${month}-01`;
    to = read("ate") ? brazilianToIso(read("ate")) : `${month}-${lastDay}`;
  } catch { throw new ReportError("Informe as datas no formato DD/MM/AAAA."); }
  const kind = read("tipo") || "payments", status = read("situacao") || "all";
  const lawyerId = read("advogada"), client = read("cliente"), cpf = onlyDigits(read("cpf"));
  const origin = read("origem"), service = read("servico");
  if (!Object.hasOwn(reportLabels, kind) || !Object.hasOwn(reportStatuses, status) || from > to || from < "1900-01-01" || to > "2200-12-31" ||
    (lawyerId && !uuid.test(lawyerId)) || client.length > 160 || service.length > 180 ||
    (read("cpf") && (cpf.length !== 11 || !/^[\d.\-\s]+$/.test(read("cpf")))) || (origin && !ORIGINS.includes(origin as typeof ORIGINS[number])) ||
    (kind !== "installments" && status !== "all")) throw new ReportError("Confira o período e os filtros selecionados.");
  return { kind: kind as ReportKind, from, to, lawyerId, client, cpf, origin, service, status: status as ReportFilters["status"] };
}
export function reportQuery(filters: ReportFilters): string {
  return new URLSearchParams({ tipo: filters.kind, de: formatDateBR(filters.from), ate: formatDateBR(filters.to),
    advogada: filters.lawyerId, cliente: filters.client, cpf: filters.cpf, origem: filters.origin,
    servico: filters.service, situacao: filters.status }).toString();
}
export type ReportColumn = { label: string; weight: number; align?: "right" };
export type ReportSection = { title: string; columns: ReportColumn[]; rows: string[][]; empty?: string };
export type ReportDocument = { title: string; subtitle: string; officeName: string; audience: string; issuedBy: string;
  issuedAt: string; period: string; filters: string[]; metrics: { label: string; value: string; hint?: string }[];
  sections: ReportSection[]; notes: string[]; reference?: string };
export type OperationalReportRow = { row_id: string; contract_id: string; lawyer_id: string; lawyer_name: string;
  clients: { name: string; cpf: string | null }[]; origin: string; service_name: string | null;
  contract_date: string; total_contract_value: number | string | null; payment_method: string | null;
  event_date: string; payment_id: string | null; installment_label: string | null; due_date: string | null;
  contractual_amount: number | string | null; received_amount: number | string | null; balance: number | string | null;
  status: keyof typeof operationalStatusLabels | null };
const money = (cents: number) => formatBRL(cents / 100);
const cents = (value: number | string | null) => value === null ? 0 : numericToCents(value);
export function operationalDocument(rows: OperationalReportRow[], filters: ReportFilters, scope: ReportScope,
  context: { officeName: string; issuedBy: string; issuedAt: string; today: string; lawyerName?: string },
  commissions: Map<string, number> = new Map()): ReportDocument {
  const received = rows.reduce((sum, row) => sum + cents(row.received_amount), 0);
  const known = filters.kind === "contracts" ? rows.reduce((sum, row) => sum + cents(row.total_contract_value), 0) : 0;
  const commission = rows.reduce((sum, row) => sum + (commissions.get(row.payment_id ?? "") ?? 0), 0);
  const planned = filters.kind === "installments" ? rows.reduce((sum, row) => sum + cents(row.contractual_amount), 0) : 0;
  const balance = filters.kind === "installments" ? rows.reduce((sum, row) => sum + cents(row.balance), 0) : 0;
  if (![received, known, commission, planned, balance].every(Number.isSafeInteger))
    throw new ReportError("Os totais excedem a precisão permitida. Reduza o período do relatório.");
  const missing = scope.financial && filters.kind === "payments" ? rows.filter(row => !commissions.has(row.payment_id!)).length : 0;
  const metrics: ReportDocument["metrics"] = filters.kind === "payments"
    ? [{ label: "Recebido no período", value: money(received) }, ...(scope.financial ? [{ label: "Comissão gerada", value: money(commission), hint: "Comissões registradas nos recebimentos" }] : []),
      { label: "Recebimentos", value: String(rows.length) }]
    : filters.kind === "installments" ? [
      { label: "Valor contratual", value: money(planned) },
      { label: "Recebido até a emissão", value: money(received) }, { label: "Saldo das parcelas", value: money(balance) }]
      : [{ label: "Contratos no filtro", value: String(rows.length) }, { label: "Valor contratado conhecido", value: money(known) },
        { label: "Valores a apurar", value: String(rows.filter(row => row.total_contract_value === null).length) }];
  const common: ReportColumn[] = [{ label: "Cliente / serviço", weight: 3.8 }, ...(scope.canSelectLawyer ? [{ label: "Advogada", weight: 1.65 }] : [])];
  let columns: ReportColumn[], values: string[][];
  const identity = (row: OperationalReportRow) => [row.clients.map(person => person.name).join(" / ") + `\n${row.service_name || "Serviço não informado"}\n${row.origin}`,
    ...(scope.canSelectLawyer ? [row.lawyer_name] : [])];
  if (filters.kind === "payments") {
    columns = [{ label: "Pagamento", weight: 1.35 }, ...common, { label: "Parcela", weight: 1.2 }, { label: "Recebido", weight: 1.6, align: "right" },
      ...(scope.financial ? [{ label: "Comissão", weight: 1.6, align: "right" as const }] : [])];
    values = rows.map(row => [formatDateBR(row.event_date), ...identity(row), row.installment_label ?? "—", money(cents(row.received_amount)),
      ...(scope.financial ? [commissions.has(row.payment_id!) ? money(commissions.get(row.payment_id!)!) : "A apurar"] : [])]);
  } else if (filters.kind === "installments") {
    columns = [{ label: "Vencimento", weight: 1.35 }, ...common, { label: "Parcela / situação", weight: 1.7 },
      { label: "Contratual", weight: 1.6, align: "right" }, { label: "Recebido", weight: 1.6, align: "right" }, { label: "Saldo", weight: 1.6, align: "right" }];
    values = rows.map(row => [formatDateBR(row.event_date), ...identity(row), `${row.installment_label}\n${row.status ? operationalStatusLabels[row.status] : "—"}`,
      money(cents(row.contractual_amount)), money(cents(row.received_amount)), money(cents(row.balance))]);
  } else {
    columns = [{ label: "Data do contrato", weight: 1.5 }, ...common, { label: "Pagamento", weight: 1.5 }, { label: "Valor contratado", weight: 1.8, align: "right" }];
    const methods: Record<string, string> = { cash: "À vista", installments: "Parcelado", success_only: "Apenas no êxito" };
    values = rows.map(row => [formatDateBR(row.event_date), ...identity(row), methods[row.payment_method ?? ""] ?? "Não informado",
      row.total_contract_value === null ? "A apurar" : money(cents(row.total_contract_value))]);
  }
  const basis = filters.kind === "payments" ? "Data efetiva do recebimento" : filters.kind === "installments" ? "Data de vencimento das parcelas" : "Data do documento contratual";
  const selected = [basis, ...(filters.client ? [`Cliente: ${filters.client}`] : []), ...(filters.cpf ? [`CPF: ${filters.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}`] : []),
    ...(filters.origin ? [`Origem: ${filters.origin}`] : []), ...(filters.service ? [`Serviço: ${filters.service}`] : []),
    ...(filters.status !== "all" ? [`Situação: ${reportStatuses[filters.status]}`] : [])];
  return { title: `Relatório de ${reportLabels[filters.kind].toLocaleLowerCase("pt-BR")}`, subtitle: "Uma visão organizada dos registros do período.",
    officeName: context.officeName, audience: context.lawyerName || (scope.lawyerId ? "Minha carteira" : "Todas as advogadas do escritório"),
    issuedBy: context.issuedBy, issuedAt: context.issuedAt, period: `${formatDateBR(filters.from)} a ${formatDateBR(filters.to)}`,
    filters: selected, metrics, sections: [{ title: `${reportLabels[filters.kind]} · ${rows.length} registro(s)`, columns, rows: values }],
    notes: ["Cada contrato, parcela ou recebimento aparece uma vez, mesmo quando há vários contratantes.",
      ...(filters.kind === "payments" ? [`Somente pagamentos válidos, sem estornos e sem recebimentos com data futura.${scope.financial ? " A comissão efetiva usa os valores registrados sobre o pagamento recebido." : ""}`] : []),
      ...(filters.kind === "installments" ? [`Saldos e situações atualizados até ${formatDateBR(context.today)}, inclusive recebimentos fora do período de vencimento. Valores previstos não representam recebimentos confirmados.`] : []),
      ...(filters.kind === "contracts" ? ["A data do documento não comprova assinatura ou fechamento da contratação. Valores a apurar no êxito não são estimados neste total."] : []),
      ...(missing ? [`${missing} recebimento(s) ainda sem comissão registrada; esses valores não foram estimados.`] : [])] };
}
