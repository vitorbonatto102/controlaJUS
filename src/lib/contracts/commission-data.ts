import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CommissionMode } from "./commission-retention";

export type ContractCommissionTerms = {
  contract_id: string; commission_percentage: number;
  commission_mode?: CommissionMode; commission_upfront_limit?: number | null;
};

export async function loadCommissionTerms(): Promise<ContractCommissionTerms[]> {
  const supabase = await createClient();
  const terms: ContractCommissionTerms[] = [];
  let fields = "contract_id,commission_percentage,commission_mode,commission_upfront_limit";
  for (let offset = 0; ; offset += 200) {
    const fetchPage = () => supabase.from("contract_financial_terms").select(fields).order("contract_id").range(offset, offset + 199);
    let { data, error } = await fetchPage();
    if (error?.code === "42703" && /commission_mode|commission_upfront_limit/.test(error.message)) {
      fields = "contract_id,commission_percentage";
      ({ data, error } = await fetchPage());
    }
    if (error) throw new Error("Não foi possível carregar as condições de comissão.");
    const page = (data ?? []) as unknown as ContractCommissionTerms[];
    terms.push(...page.map((item) => ({ ...item, commission_percentage: Number(item.commission_percentage),
      commission_mode: item.commission_mode ?? "proportional",
      commission_upfront_limit: item.commission_upfront_limit == null ? null : Number(item.commission_upfront_limit) })));
    if (page.length < 200) break;
  }
  return terms;
}
