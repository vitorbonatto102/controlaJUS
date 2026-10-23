import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function hasInstallmentNotes(contractId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("collection_notes").select("id")
    .eq("contract_id", contractId).not("installment_id", "is", null).limit(1);
  if (error) throw new Error("Não foi possível consultar o histórico deste contrato.");
  return (data?.length ?? 0) > 0;
}
