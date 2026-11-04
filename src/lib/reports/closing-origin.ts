import {formatBRL,formatDateBR} from "@/lib/formatters";
import type {ReportDocument} from "./model";
import {closingDocument,type ClosedReportData} from "./closing";

export type ClosingOriginData={
  version:2;issued_at:string;office_name:string;lawyer_name:string;origins:string[];
  full_report?:ClosedReportData;
  personal_only?:boolean;
  closing:{id:string;reference_month:number;reference_year:number;closed_at:string};
  rows:{payment_id:string;contract_id:string;payment_date:string;client_name:string;origin:string;recipient_name?:string|null;received_amount:number;lawyer_amount:number;third_party_amount:number}[];
  recipients:{contract_id:string;client_name:string;origin:string;name:string;kind:string;amount:number}[];
};
function total(values:number[]){
  const cents=values.reduce((sum,value)=>sum+Math.round(Number(value)*100),0);
  if(!Number.isSafeInteger(cents)) throw new Error("Total fora da precisão permitida no relatório.");
  return cents;
}
export function closingOriginDocument(data:ClosingOriginData,issuedBy:string):ReportDocument {
  const received=total(data.rows.map(row=>row.received_amount)),lawyer=total(data.rows.map(row=>row.lawyer_amount)),thirds=total(data.rows.map(row=>row.third_party_amount));
  const money=(cents:number)=>formatBRL(cents/100),partial=data.origins.length>0;
  const original=data.full_report?closingDocument(data.full_report,issuedBy,data.issued_at):null;
  const report:ReportDocument={title:partial?"Relatório do fechamento por origem":"Relatório de fechamento mensal",
    subtitle:partial?"Recorte dos recebimentos e participações do mês confirmado.":"Recebimentos e participações consolidados, com as correções registradas.",
    officeName:data.office_name,audience:data.lawyer_name,issuedBy,issuedAt:data.issued_at,
    period:`${String(data.closing.reference_month).padStart(2,"0")}/${data.closing.reference_year}`,reference:data.closing.id,
    filters:[data.origins.length?`Origens: ${data.origins.join("; ")}`:"Todas as origens",`Fechamento confirmado em ${formatDateBR(new Date(data.closing.closed_at))}`],
    metrics:[{label:"Recebimentos no relatório",value:money(received)},{label:"Participação da advogada",value:money(lawyer)},
      {label:"Destinado a terceiros",value:money(thirds)},{label:"Participação do escritório",value:money(received-lawyer-thirds),hint:"Antes de despesas e tributos"}],
    sections:[{title:"Recebimentos e participações",columns:[{label:"Pagamento",weight:1.3},{label:"Cliente / origem",weight:3.8},
      {label:"Recebido",weight:1.7,align:"right"},{label:"Advogada",weight:1.7,align:"right"},{label:"Terceiros",weight:1.7,align:"right"}],
      rows:data.rows.map(row=>[formatDateBR(row.payment_date),`${row.client_name}\n${row.origin}`,formatBRL(Number(row.received_amount)),formatBRL(Number(row.lawyer_amount)),`${row.recipient_name||data.recipients.find(r=>r.contract_id===row.contract_id&&r.origin===row.origin&&r.kind!=="lawyer")?.name||"Sem terceiro informado"}\n${formatBRL(Number(row.third_party_amount))}`]),empty:"Nenhum recebimento para as origens selecionadas."},
      {title:"Destinação por beneficiário",columns:[{label:"Cliente / origem",weight:4},{label:"Beneficiário",weight:4},{label:"Valor retido",weight:2,align:"right"}],
      rows:data.recipients.map(row=>[`${row.client_name}\n${row.origin}`,`${row.name}\n${row.kind==="lawyer"?"Advogada":row.kind==="commercial"?"Comercial":"Terceiro"}`,formatBRL(Number(row.amount))]),empty:"Nenhuma participação a demonstrar."}],
    notes:["O fechamento mensal permanece integral. A seleção de origens altera somente este relatório.",
      "Valores consolidados a partir da composição confirmada e dos ajustes posteriores. O histórico original permanece preservado.",
      "Valor retido identifica a destinação do recebimento; não comprova pagamento do repasse ao beneficiário. Confira os pagamentos registrados no fechamento completo.",
      "A retenção nas primeiras parcelas respeita o limite total de cada beneficiário. A retenção proporcional acompanha cada recebimento registrado.",
      "Não há data de repasse presumida pela origem. Os pagamentos efetivamente realizados continuam registrados pelo gestor."]};
  if(original){
    report.metrics=data.personal_only?[{label:"Recebimentos com participação",value:money(received)},...original.metrics.filter(m=>m.label!=="Recebido pelo escritório"),{label:"Destinado a terceiros",value:money(thirds)}]:[...original.metrics,{label:"Destinado a terceiros",value:money(thirds)}];
    report.sections.push(...original.sections.filter(section=>section.title!=="Agenda de repasses por contrato"&&(!data.personal_only||section.title==="Histórico de repasses")));
    report.notes.push(...original.notes);
  }
  if(data.personal_only)report.notes.push("Parcelas da retenção inicial destinadas exclusivamente ao escritório ficam fora deste controle pessoal. O fechamento integral e seus totais originais permanecem preservados.");
  return report;
}
