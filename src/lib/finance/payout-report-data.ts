import "server-only";
import type {CurrentProfile} from "@/lib/auth/profile";
import {createClient} from "@/lib/supabase/server";
import {isReportId,ReportError} from "@/lib/reports/model";
import type {PayoutReport} from "./payout-report-model";

export async function loadPayoutReport(profile:CurrentProfile,id:string):Promise<PayoutReport>{
  if(!["lawyer","manager"].includes(profile.role))throw new ReportError("Seu perfil não permite consultar repasses.",403);
  if(!isReportId(id))throw new ReportError("Relatório indisponível.",404);
  const supabase=await createClient();const {data,error}=await supabase.rpc("get_payout_report",{p_report:id});
  if(error?.code==="P0002")throw new ReportError("Relatório indisponível para este usuário.",404);
  if(error?.code==="42501")throw new ReportError("Acesso não autorizado.",403);
  if(error?.code==="PGRST202")throw new ReportError("A confirmação de recebimentos aguarda a atualização do banco.",503);
  if(error||!data)throw new ReportError("Não foi possível consultar o relatório. Tente novamente.",503);
  return data as PayoutReport;
}
export type PayoutReportSummary={id:string;closing_id:string;origins:string[];amount_due:number;created_at:string;reference_month:number;reference_year:number};
export async function loadPayoutReports(lawyerId:string):Promise<{available:boolean;reports:PayoutReportSummary[]}>{
  const supabase=await createClient();const {data,error}=await supabase.from("payout_reports").select("id,closing_id,origins,amount_due,created_at,monthly_closings!inner(reference_month,reference_year)")
    .eq("lawyer_id",lawyerId).order("created_at",{ascending:false}).order("id").limit(50);
  if(error&&["42P01","PGRST205"].includes(error.code))return {available:false,reports:[]};
  if(error)throw new Error("Não foi possível carregar os relatórios emitidos.");
  const rows=(data??[]) as unknown as (Omit<PayoutReportSummary,"reference_month"|"reference_year">&{monthly_closings:{reference_month:number;reference_year:number}})[];
  return {available:true,reports:rows.map(({monthly_closings,...r})=>({...r,...monthly_closings,amount_due:Number(r.amount_due)}))};
}
