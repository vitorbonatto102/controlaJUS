import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function loadContractServices(contractIds: string[]) {
  const services = new Map<string, string | null>();
  if (!contractIds.length) return services;
  const supabase = await createClient();
  for (let offset = 0; offset < contractIds.length; offset += 200) {
    const { data, error } = await supabase.from("contracts").select("id,service_name")
      .in("id", contractIds.slice(offset, offset + 200));
    // Existing pages remain accessible while the new migration is being applied.
    if (error && ["42703", "PGRST204"].includes(error.code) && error.message.includes("service_name")) return services;
    if (error) throw new Error("Não foi possível carregar o serviço contratado.");
    for (const contract of data ?? []) services.set(contract.id, contract.service_name);
  }
  return services;
}
