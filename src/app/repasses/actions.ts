"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireRole} from "@/lib/auth/profile";
import {createClient} from "@/lib/supabase/server";
import {isReportId} from "@/lib/reports/model";
import {parseClosingOrigins} from "@/lib/reports/closing-filters";
import {parseMoneyBR} from "@/lib/contracts/finance";
import {brazilianToIso} from "@/lib/contracts/registration";
import type {ActionState} from "@/lib/action-state";

const read=(form:FormData,key:string)=>String(form.get(key)??"").trim();
function failure(error:{code?:string;message:string}):ActionState{
  return {success:null,error:error.code==="PGRST202"?"Peça ao administrador para aplicar a atualização de confirmação de recebimentos no Supabase.":
    error.code==="P0001"?error.message:"Não foi possível concluir. Recarregue a página e tente novamente."};
}
function refresh(report:string){for(const path of ["/advogada","/advogada/carteira","/advogada/fechamentos","/gestor","/notificacoes","/advogada/notificacoes","/relatorios"])
  revalidatePath(path);revalidatePath("/fechamentos","layout");revalidatePath(`/repasses/${report}`);}

export async function issuePayoutReport(_state:ActionState,form:FormData):Promise<ActionState>{
  await requireRole("lawyer");const id=read(form,"request"),closing=read(form,"closing");
  if(!isReportId(id)||!isReportId(closing))return {error:"Recarregue a página antes de emitir o relatório.",success:null};
  let origins:string[];
  try{const query=new URLSearchParams();for(const origin of form.getAll("origem"))query.append("origem",String(origin));origins=parseClosingOrigins(query);}
  catch{return {error:"Selecione origens válidas.",success:null};}
  const supabase=await createClient();const {data,error}=await supabase.rpc("issue_payout_report",{p_report:id,p_closing:closing,p_origins:origins});
  if(error)return failure(error);revalidatePath("/advogada/fechamentos");redirect(`/repasses/${data}`);
}
export async function confirmPayoutReceipt(_state:ActionState,form:FormData):Promise<ActionState>{
  await requireRole("lawyer");const report=read(form,"report"),request=read(form,"request"),notes=read(form,"notes");
  const amount=parseMoneyBR(read(form,"amount"));let date:string;
  try{date=brazilianToIso(read(form,"date"));}catch{return {error:"Informe a data real em DD/MM/AAAA.",success:null};}
  if(!isReportId(report)||!isReportId(request)||amount===null||amount<=0||amount>99999999999999||notes.length>1000||form.get("confirm")!=="yes")
    return {error:"Confira o valor e confirme que o dinheiro já entrou na sua conta.",success:null};
  const supabase=await createClient();const {error}=await supabase.rpc("confirm_payout_receipt",{p_report:report,p_request:request,p_amount_cents:amount,p_date:date,p_notes:notes||null});
  if(error)return failure(error);refresh(report);redirect(`/repasses/${report}?confirmado=1`);
}
export async function reverseOwnReceipt(_state:ActionState,form:FormData):Promise<ActionState>{
  await requireRole("lawyer");const report=read(form,"report"),transfer=read(form,"transfer"),reason=read(form,"reason");
  if(!isReportId(report)||!isReportId(transfer)||reason.length<5||reason.length>1000)return {error:"Informe o motivo da correção (5 a 1000 caracteres).",success:null};
  const supabase=await createClient();const {error}=await supabase.rpc("reverse_own_payout_receipt",{p_transfer:transfer,p_reason:reason});
  if(error)return failure(error);refresh(report);redirect(`/repasses/${report}?corrigido=1`);
}
