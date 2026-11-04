import {commercialTargetCents,commissionTargetCents,projectContractCommissions,type CommissionTerms} from "@/lib/contracts/commission-retention";
import {numericToCents} from "@/lib/contracts/finance";
import {formatBRL} from "@/lib/formatters";
import {operationalDocument,ReportError,type OperationalReportRow,type ReportFilters,type ReportScope} from "./model";

export type FinancialReportContract=CommissionTerms&{contract_id:string;lawyer_name:string;commercial_recipient_name:string|null;generated_amount:number;
  items:{id:string;dueDate:string;order:number;contractualCents:number;paidCents:number;participation_received:boolean}[]};
export type FinancialReportPayload={rows:OperationalReportRow[];as_of:string;issued_at:string;personal_only:boolean;
  commissions:{payment_id:string;amount:number}[];third_commissions:{payment_id:string;amount:number|null;recipient_name:string|null}[];
  financial_contracts:FinancialReportContract[]};

export function participationDocument(payload:FinancialReportPayload,filters:ReportFilters,scope:ReportScope,context:Parameters<typeof operationalDocument>[3]){
  if(!Array.isArray(payload.financial_contracts)||!Array.isArray(payload.third_commissions)||!Array.isArray(payload.commissions))
    throw new ReportError("As participações do relatório estão indisponíveis.",503);
  const contracts=new Map(payload.financial_contracts.map(c=>[c.contract_id,c]));
  const commissions=new Map(payload.commissions.map(p=>[p.payment_id,numericToCents(p.amount)]));
  const thirds=new Map(payload.third_commissions.map(p=>[p.payment_id,{cents:p.amount===null?null:numericToCents(p.amount),name:p.recipient_name}]));
  const plans=new Map(filters.kind==="installments"?payload.financial_contracts.map(c=>[c.contract_id,projectContractCommissions(c.items,c,numericToCents(c.generated_amount))]):[]);
  const rows=payload.rows.filter(row=>{
    const contract=contracts.get(row.contract_id);
    if(!contract)throw new ReportError("Condições contratuais ausentes no relatório.",503);
    if(!payload.personal_only||contract.commission_mode!=="upfront"||filters.kind==="contracts")return true;
    if(filters.kind==="payments")return !commissions.has(row.payment_id!)||thirds.get(row.payment_id!)?.cents==null||
      (commissions.get(row.payment_id!)??0)>0||(thirds.get(row.payment_id!)?.cents??0)>0;
    const plan=plans.get(row.contract_id)?.get(row.row_id),item=contract.items.find(i=>i.id===row.row_id);
    return (plan?.remainingEstimatedCents??0)>0||(plan?.thirdPartyRemainingCents??0)>0||!!item?.participation_received;
  });
  const report=operationalDocument(rows,filters,scope,context,commissions),section=report.sections[0];
  const money=(cents:number|null|undefined)=>cents==null?"A apurar":formatBRL(cents/100);
  if(filters.kind==="payments"){
    const thirdTotal=rows.reduce((sum,row)=>sum+(thirds.get(row.payment_id!)?.cents??0),0);
    const missing=rows.some(row=>!commissions.has(row.payment_id!)||thirds.get(row.payment_id!)?.cents==null);
    const received=rows.reduce((sum,row)=>sum+numericToCents(row.received_amount!),0),lawyer=rows.reduce((sum,row)=>sum+(commissions.get(row.payment_id!)??0),0);
    report.metrics=[report.metrics[0],report.metrics[1],{label:"Terceiros/comercial",value:missing?"A apurar":money(thirdTotal)},
      {label:"Participação do escritório",value:missing?"A apurar":money(received-lawyer-thirdTotal),hint:"Antes de despesas e tributos"}];
    section.columns.push({label:"Terceiro/comercial",weight:2.5,align:"right"},{label:"Escritório",weight:1.6,align:"right"});
    section.rows.forEach((cells,index)=>{
      const row=rows[index],third=thirds.get(row.payment_id!),lawyer=commissions.get(row.payment_id!);
      const office=third?.cents==null||lawyer==null?null:numericToCents(row.received_amount!)-lawyer-third.cents;
      if(office!==null&&office<0)throw new ReportError("As participações divergem do recebimento. Solicite conferência ao gestor.",503);
      cells.push(`${third?.name||"Sem terceiro informado"}\n${money(third?.cents)}`,money(office));
    });
  }else if(filters.kind==="installments"){
    section.columns.push({label:"Advogada · previsão",weight:1.7,align:"right"},{label:"Terceiro · previsão",weight:2.5,align:"right"},{label:"Escritório · previsão",weight:1.7,align:"right"});
    let lawyerTotal=0,thirdTotal=0;
    section.rows.forEach((cells,index)=>{
      const row=rows[index],plan=plans.get(row.contract_id)?.get(row.row_id),contract=contracts.get(row.contract_id)!;
      if(!plan)throw new ReportError("Cronograma incompleto para calcular a previsão.",503);
      lawyerTotal+=plan.estimatedCents;thirdTotal+=plan.thirdPartyEstimatedCents;
      cells.push(money(plan.estimatedCents),`${contract.commercial_recipient_name||"Sem terceiro informado"}\n${money(plan.thirdPartyEstimatedCents)}`,money(plan.officeEstimatedCents));
    });
    report.metrics.push({label:"Advogada · previsão contratual",value:money(lawyerTotal)},{label:"Terceiros · previsão contratual",value:money(thirdTotal)});
    report.notes.push("A destinação prevista segue o cronograma e os limites totais. A comissão efetiva aparece no relatório de recebimentos, pela ordem real dos pagamentos.");
  }else{
    section.columns.push({label:"Participação da advogada",weight:2},{label:"Terceiro/comercial",weight:2.5});
    section.rows.forEach((cells,index)=>{
      const c=contracts.get(rows[index].contract_id)!,upfront=c.commission_mode==="upfront";
      cells.push(upfront?`Limite total: ${money(commissionTargetCents(c))}`:`${c.commission_percentage}% por recebimento`,
        `${c.commercial_recipient_name||"Sem terceiro informado"}\n${upfront?`Limite total: ${money(commercialTargetCents(c))}`:`${c.commercial_percentage??0}% por recebimento`}`);
    });
  }
  report.notes.push("Valores destinados ao terceiro/comercial identificam a participação contratual; não comprovam que o escritório já realizou o repasse.");
  if(payload.personal_only)report.notes.push("Na retenção inicial, este controle mantém parcelas com participação prevista ou recebimentos que geraram participação. Parcelas exclusivas do escritório ficam fora desta visão; o cronograma integral é preservado.");
  return report;
}
