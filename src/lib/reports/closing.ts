import type { Closing, ClosingItem, ClosingAdjustment, Transfer } from "@/lib/finance/data";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import type { ReportDocument } from "./model";
import type { PayoutAgenda } from "@/lib/finance/payouts";

export type ClosedReportData = { closing: Closing; lawyer_name: string; office_name: string; payout_agenda?: PayoutAgenda;
  items: Pick<ClosingItem, "id" | "payment_date" | "client_name" | "origin" | "amount_received" | "commission_percentage" | "commission_amount">[];
  adjustments: Pick<ClosingAdjustment, "id" | "office_delta" | "commission_delta" | "reason" | "created_at">[];
  transfers: Pick<Transfer, "id" | "amount" | "payment_date" | "notes" | "reversed_at" | "reversal_reason">[] };
const signedCents = (value: number) => {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Valor financeiro inválido no fechamento.");
  return cents;
};
const money = (value: number) => formatBRL(Number(value));
const plus = (a: number, b: number) => {
  const total = signedCents(a) + signedCents(b);
  if (!Number.isSafeInteger(total)) throw new Error("Total financeiro inválido no fechamento.");
  return formatBRL(total / 100);
};
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
export function closingDocument(data: ClosedReportData, issuedBy: string, issuedAt: string): ReportDocument {
  const c = data.closing;
  const status = { draft: "Em apuração", closed: "Fechado", partial: "Parcialmente pago", paid: "Pago" }[c.status];
  return { title: "Relatório de fechamento mensal", subtitle: "Composição confirmada, ajustes posteriores e posição dos repasses.",
    officeName: data.office_name, audience: data.lawyer_name, issuedBy, issuedAt,
    period: `${String(c.reference_month).padStart(2, "0")}/${c.reference_year}`, reference: c.id,
    filters: [`Situação: ${status}`, `Fechamento confirmado em ${dateTime(c.closed_at!)}`],
    metrics: [{ label: "Recebido pelo escritório", value: plus(c.office_amount_received, c.office_adjustment_amount), hint: "Com ajustes posteriores" },
      { label: "Comissão consolidada", value: plus(c.commission_amount, c.adjustment_amount), hint: "Com ajustes posteriores" },
      { label: "Já repassado", value: money(c.amount_already_transferred) }, { label: "Pendente de repasse", value: money(c.amount_pending_transfer) }],
    sections: [
      { title: "Composição original confirmada", columns: [{ label: "Pagamento", weight: 1.5 }, { label: "Cliente / origem", weight: 4 },
        { label: "Recebido", weight: 1.8, align: "right" }, { label: "Participação", weight: 1.35, align: "right" }, { label: "Comissão", weight: 1.8, align: "right" }],
        rows: data.items.map(item => [formatDateBR(item.payment_date), `${item.client_name}\n${item.origin}`, money(item.amount_received),
          `${Number(item.commission_percentage).toLocaleString("pt-BR")}%`, money(item.commission_amount)]), empty: "Nenhum recebimento compôs o fechamento original." },
      { title: "Ajustes após o fechamento", columns: [{ label: "Registrado em", weight: 1.5 }, { label: "Motivo", weight: 4.5 },
        { label: "Recebido (diferença)", weight: 2, align: "right" }, { label: "Comissão (diferença)", weight: 2, align: "right" }],
        rows: data.adjustments.map(item => [formatDateBR(new Date(item.created_at)), item.reason, money(item.office_delta), money(item.commission_delta)]),
        empty: "Nenhum ajuste posterior registrado." },
      { title: "Histórico de repasses", columns: [{ label: "Data", weight: 1.5 }, { label: "Valor", weight: 1.8, align: "right" },
        { label: "Situação / observação", weight: 6.5 }],
        rows: data.transfers.map(item => [formatDateBR(item.payment_date), money(item.amount), item.reversed_at
          ? `Estornado em ${formatDateBR(new Date(item.reversed_at))}\n${item.reversal_reason || ""}` : `Repassado\n${item.notes || "Sem observação"}`]),
        empty: "Nenhum repasse registrado." },
      ...(data.payout_agenda ? [{ title: "Agenda de repasses por contrato", columns: [
        { label: "Cliente / beneficiário", weight: 3.8 }, { label: "Previsto para", weight: 1.6 }, { label: "Valor", weight: 1.8, align: "right" as const },
        { label: "Pago identificado", weight: 1.8, align: "right" as const }, { label: "Saldo", weight: 1.8, align: "right" as const }],
        rows: data.payout_agenda.items.map(item => [`${item.client_name}\n${item.origin} · ${item.recipient === "lawyer" ? "Advogada" : "Comercial"}`,
          formatDateBR(item.due_date), money(item.amount), money(item.paid), money(item.balance)]), empty: "Sem valores programados." }] : []),
      ...(data.payout_agenda?.commercial_transfers?.length ? [{ title: "Repasses comerciais", columns: [
        { label: "Data", weight: 1.5 }, { label: "Valor", weight: 1.8, align: "right" as const }, { label: "Beneficiário / situação", weight: 6.5 }],
        rows: data.payout_agenda.commercial_transfers.map(t => [formatDateBR(t.payment_date),money(t.amount),`${t.notes || "Comercial"}${t.reversed_at ? `\nEstornado: ${t.reversal_reason}` : "\nPago"}`]) }] : []),
    ], notes: [
      `Totais originais: recebido ${money(c.office_amount_received)}; comissão ${money(c.commission_amount)}. Ajustes: recebido ${money(c.office_adjustment_amount)}; comissão ${money(c.adjustment_amount)}.`,
      "Composição histórica preservada. A participação é o percentual contratual; a comissão segue os valores registrados e a forma de retenção.",
      "Repasses atualizados até a emissão. Estornos ficam fora do total repassado.",
      ...(data.payout_agenda ? ["Datas da agenda são previsões; pagamentos parciais ficam vinculados ao contrato. A reserva comercial não compõe o saldo da advogada.",
        ...(data.payout_agenda.unallocated_transfers.length ? [`Repasses já registrados, aguardando identificação dos contratos: ${money(data.payout_agenda.unallocated_transfers.reduce((sum,t)=>sum+Number(t.amount),0))}. Esses valores já estão no total repassado do fechamento.`] : [])] : []),
      ...(Number(c.amount_overpaid) > 0 ? [`Excesso de repasse a regularizar: ${money(c.amount_overpaid)}.`] : []),
      "Este demonstrativo interno não substitui comprovantes de pagamento, documentos fiscais ou registros bancários.",
    ] };
}
