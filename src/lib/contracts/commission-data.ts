import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CommissionMode } from "./commission-retention";

export type ContractCommissionTerms = {
  contract_id: string; commission_percentage: number; commercial_percentage?: number; commercial_recipient_name?: string | null; payout_day?: number | null; first_payout_date?: string | null;
  commission_mode?: CommissionMode; commission_upfront_limit?: number | null;
  upfront_distribution?: "lawyer_only" | "shared" | null; third_party_upfront_limit?: number | null;
};

export async function loadCommissionTerms(): Promise<ContractCommissionTerms[]> {
  const supabase = await createClient();
  const terms: ContractCommissionTerms[] = [];
  let fields = "contract_id,commission_percentage,commission_mode,commission_upfront_limit,upfront_distribution,third_party_upfront_limit,commercial_recipient_name,commercial_percentage,payout_day,first_payout_date";
  for (let offset = 0; ; offset += 200) {
    const fetchPage = () => supabase.from("contract_financial_terms").select(fields).order("contract_id").range(offset, offset + 199);
    let { data, error } = await fetchPage();
    if(error && ["42703","PGRST204"].includes(error.code) && /upfront_distribution|third_party_upfront_limit/.test(error.message)) {
      fields=fields.replace(",upfront_distribution,third_party_upfront_limit","");({data,error}=await fetchPage());
    }
    if (error && ["42703", "PGRST204"].includes(error.code) && error.message.includes("commercial_recipient_name")) {
      fields = fields.replace(",commercial_recipient_name", "");
      ({ data, error } = await fetchPage());
    }
    if (error && ["42703", "PGRST204"].includes(error.code) && /commercial_percentage|payout_day|first_payout_date/.test(error.message)) {
      fields = fields.replace(",commercial_percentage,payout_day,first_payout_date", "").replace(",commercial_recipient_name", "").replace(",upfront_distribution,third_party_upfront_limit", "");
      ({ data, error } = await fetchPage());
    }
    if (error?.code === "42703" && /commission_mode|commission_upfront_limit/.test(error.message)) {
      fields = "contract_id,commission_percentage";
      ({ data, error } = await fetchPage());
    }
    if (error) throw new Error("Não foi possível carregar as condições de comissão.");
    const page = (data ?? []) as unknown as ContractCommissionTerms[];
    terms.push(...page.map((item) => ({ ...item, commission_percentage: Number(item.commission_percentage),
      third_party_upfront_limit: item.third_party_upfront_limit == null ? null : Number(item.third_party_upfront_limit),
      commission_mode: item.commission_mode ?? "proportional",
      commission_upfront_limit: item.commission_upfront_limit == null ? null : Number(item.commission_upfront_limit) })));
    if (page.length < 200) break;
  }
  return terms;
}
