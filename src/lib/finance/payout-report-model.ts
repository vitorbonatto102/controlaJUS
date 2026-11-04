import {formatBRL} from "@/lib/formatters";
import {closingOriginDocument,type ClosingOriginData} from "@/lib/reports/closing-origin";

export type PayoutReportItem={contract_id:string;client_name:string;origin:string;commission_cents:number;balance_cents:number;fingerprint:string};
export type PayoutReceipt={id:string;amount:number;payment_date:string;notes:string|null;recorded_by:string;created_at:string;reversed_at:string|null;reversal_reason:string|null};
export type PayoutReport={id:string;office_id:string;lawyer_id:string;closing_id:string;origins:string[];snapshot:ClosingOriginData;
  items:PayoutReportItem[];amount_due:number;created_by:string;created_at:string;available_cents:number;stale:boolean;availability_error:string|null;receipts:PayoutReceipt[]};

/** A download always uses the issued snapshot, never recalculates the document. */
export function payoutReportDocument(report:PayoutReport){
  const document=closingOriginDocument({...report.snapshot,full_report:undefined},report.snapshot.lawyer_name);
  const thirdCents=report.snapshot.rows.reduce((sum,row)=>sum+Math.round(Number(row.third_party_amount)*100),0);
  document.title="Relatório para repasse";
  document.subtitle="Participação da advogada a receber, conforme o saldo apurado na emissão.";
  document.issuedAt=report.created_at;document.reference=report.closing_id;
  document.filters.push(`Relatório ${report.id.slice(0,8)}`);
  document.metrics=[{label:"A receber pela advogada na emissão",value:formatBRL(report.amount_due)},
    {label:"Terceiros/comercial · participação",value:formatBRL(thirdCents/100),hint:"Informativo; não integra a confirmação da advogada"}];
  document.sections.unshift({title:"Valores solicitados para a advogada",columns:[{label:"Cliente / origem",weight:4},
    {label:"Participação no mês",weight:2,align:"right"},{label:"A receber na emissão",weight:2,align:"right"}],
    rows:report.items.map(item=>[`${item.client_name}\n${item.origin}`,formatBRL(item.commission_cents/100),formatBRL(item.balance_cents/100)])});
  document.notes.unshift("Este documento preserva a posição da emissão. Confirmações e correções posteriores são consultadas na Repassum; não alteram o PDF já emitido.",
    "A confirmação é feita pela própria advogada somente após o dinheiro entrar em sua conta. Pode haver recebimentos parciais. Os valores de terceiros/comercial são demonstrados separadamente.");
  return document;
}
