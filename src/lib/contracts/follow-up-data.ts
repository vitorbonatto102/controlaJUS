import "server-only";
import type { CurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import type { FollowUpContract } from "./follow-up";
import { loadContractParties } from "./parties-data";
import { loadContractServices } from "./service-data";

type RawContract = {
  id: string; client_id: string; lawyer_id: string; contract_date: string; origin: string;
  total_contract_value: number | null; payment_method: string | null;
  success_fee_percentage: number | null; has_additional_fee: boolean;
  additional_fee_percentage: number | null; additional_fee_basis: string | null;
  additional_fee_amount: number | null; payment_start_type: string | null;
  payment_start_condition: string | null;
  clients: { full_name: string; cpf: string | null } | { full_name: string; cpf: string | null }[] | null;
  lawyer: { full_name: string } | { full_name: string }[] | null;
};
const one = <T,>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value;
const nullableNumber = (value: number | null | undefined) => value == null ? null : Number(value);

export async function loadFollowUpContracts(profile: CurrentProfile): Promise<FollowUpContract[]> {
  if (!profile.active || !profile.office_id) throw new Error("Acesso não autorizado.");
  const supabase = await createClient();
  const contracts: FollowUpContract[] = [];
  let includeSuccessFee = true;
  for (let offset = 0; ; offset += 100) {
    const fetchPage = () => {
      let query = supabase.from("contracts").select(`id, client_id, lawyer_id, contract_date, origin,
        total_contract_value, payment_method, ${includeSuccessFee ? "success_fee_percentage," : ""} has_additional_fee,
        additional_fee_percentage, additional_fee_basis, additional_fee_amount,
        payment_start_type, payment_start_condition, clients!contracts_client_id_fkey(full_name,cpf),
        lawyer:profiles!contracts_lawyer_id_fkey(full_name)`)
        .eq("office_id", profile.office_id)
        .or("payment_method.eq.success_only,has_additional_fee.eq.true,payment_start_type.eq.condition")
        .order("contract_date", { ascending: false }).order("id")
        .range(offset, offset + 99);
      // Filtro adicional à RLS; o usuário da requisição continua sendo a autoridade.
      if (profile.role === "lawyer") query = query.eq("lawyer_id", profile.id);
      return query;
    };
    let { data, error } = await fetchPage();
    if (error?.code === "42703" && error.message.includes("success_fee_percentage")) {
      includeSuccessFee = false;
      ({ data, error } = await fetchPage());
    }
    if (error) throw new Error("Não foi possível carregar o acompanhamento dos contratos.");
    const rows = (data ?? []) as unknown as RawContract[];
    contracts.push(...rows.map((row) => ({
      id: row.id, clientId: row.client_id, clientName: one(row.clients)?.full_name ?? "Cliente indisponível",
      clientCpf: one(row.clients)?.cpf ?? null, origin: row.origin,
      lawyerId: row.lawyer_id, lawyerName: one(row.lawyer)?.full_name ?? "Advogada responsável",
      contractDate: row.contract_date, totalValue: nullableNumber(row.total_contract_value),
      payment_method: row.payment_method, has_additional_fee: row.has_additional_fee,
      payment_start_type: row.payment_start_type, paymentCondition: row.payment_start_condition,
      successFeePercentage: nullableNumber(row.success_fee_percentage),
      additionalFeePercentage: nullableNumber(row.additional_fee_percentage),
      additionalFeeAmount: nullableNumber(row.additional_fee_amount), additionalFeeBasis: row.additional_fee_basis,
    })));
    if (rows.length < 100) break;
  }
  const ids = contracts.map((contract) => contract.id);
  const [parties, services] = await Promise.all([loadContractParties(ids), loadContractServices(ids)]);
  return contracts.map((contract) => ({ ...contract, contractors: parties.get(contract.id),
    serviceName: services.get(contract.id) ?? null,
    clientName: parties.get(contract.id)?.map((party) => party.fullName).join(" / ") || contract.clientName }));
}
