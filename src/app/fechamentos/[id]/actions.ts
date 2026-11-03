"use server";
import { revalidatePath } from "next/cache";
import { requireActiveProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { brazilianToIso } from "@/lib/contracts/registration";
import { isReportId } from "@/lib/reports/model";
import type { ActionState } from "@/lib/action-state";

export async function correctClosedValues(_state: ActionState, form: FormData): Promise<ActionState> {
  const profile=await requireActiveProfile();
  if (!["lawyer","manager"].includes(profile.role)) return {error:"Acesso não autorizado.",success:null};
  const read=(key:string)=>String(form.get(key)??"").trim();
  const id=read("closing"),mode=read("mode"),reason=read("reason");
  const payment=read("payment"),installment=read("installment"),amount=parseMoneyBR(read("amount"));
  let date:string|null=null;
  try { if(mode!=="void") date=brazilianToIso(read("date")); } catch { return {error:"Informe a data no formato DD/MM/AAAA.",success:null}; }
  if(!isReportId(id)||!["add","replace","void"].includes(mode)||reason.length<5||reason.length>1000||
    (mode==="add"?!isReportId(installment):!isReportId(payment))||(mode!=="void"&&(!amount||amount>99999999999999)))
    return {error:"Confira o registro, o valor e a explicação da correção.",success:null};
  const supabase=await createClient();
  const {error}=await supabase.rpc("correct_closed_values",{p_closing:id,p_mode:mode,p_payment:payment||null,
    p_installment:installment||null,p_amount_cents:mode==="void"?null:amount,p_date:date,p_reason:reason});
  if(error) return {error:"Correção recusada. Confira se o pagamento está ativo, pertence ao fechamento e a data está dentro desse mês. Recarregue antes de tentar novamente.",success:null};
  for(const path of ["/gestor","/advogada","/advogada/carteira","/advogada/fechamentos","/advogada/notificacoes","/notificacoes","/relatorios",`/fechamentos/${id}`]) revalidatePath(path);
  return {error:null,success:"Correção salva com histórico. A outra parte foi notificada e o relatório foi atualizado."};
}
