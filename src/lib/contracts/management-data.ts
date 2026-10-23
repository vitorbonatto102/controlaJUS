import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function hasInstallmentNotes(contractId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("collection_notes").select("id")
    .eq("contract_id", contractId).not("installment_id", "is", null).limit(1);
  if (error) throw new Error("Não foi possível consultar o histórico deste contrato.");
  return (data?.length ?? 0) > 0;
}

export type ContractCollectionNote = { id: string; note_type: string; content: string; created_at: string };

export async function loadContractCollectionNotes(contractId: string) {
  const supabase = await createClient();
  const notes: ContractCollectionNote[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from("collection_notes").select("id,note_type,content,created_at")
      .eq("contract_id", contractId).order("created_at", { ascending: false }).order("id").range(offset, offset + 99);
    if (error) throw new Error("Não foi possível consultar as cobranças deste contrato.");
    notes.push(...(data ?? []));
    if (!data || data.length < 100) break;
  }
  return notes;
}
