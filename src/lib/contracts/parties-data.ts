import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContractParty } from "./parties";

export async function loadContractParties(contractIds: string[]) {
  const result = new Map<string, ContractParty[]>();
  if (!contractIds.length) return result;
  const supabase = await createClient();
  for (let offset = 0; offset < contractIds.length; offset += 40) {
    // At most 40 contracts × 20 parties, below the API's default row limit.
    const { data, error } = await supabase.from("contract_parties")
      .select("contract_id,position,clients!contract_parties_client_id_fkey(id,full_name,cpf)")
      .in("contract_id", contractIds.slice(offset, offset + 40)).order("position");
    // Old contracts remain accessible during the interval before the migration.
    if (error && (["42P01", "PGRST205"].includes(error.code) ||
      (error.code === "PGRST200" && error.message.includes("contract_parties")))) return result;
    if (error) throw new Error("Não foi possível carregar os contratantes.");
    for (const row of (data ?? []) as unknown as { contract_id: string; clients: {
      id: string; full_name: string; cpf: string | null;
    } | { id: string; full_name: string; cpf: string | null }[] | null }[]) {
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      if (!client) throw new Error("Contratante sem cadastro acessível.");
      const parties = result.get(row.contract_id) ?? [];
      parties.push({ clientId: client.id, fullName: client.full_name, cpf: client.cpf });
      result.set(row.contract_id, parties);
    }
  }
  return result;
}
