import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/lib/finance/data";

const paymentTypes = new Set(["secretary_payment_recorded", "secretary_payment_updated", "secretary_payment_voided"]);

export async function loadNotificationLinks(notifications: Notification[]) {
  const links = new Map<string, string>();
  const supabase = await createClient();
  const payments = notifications.filter((item) => paymentTypes.has(item.type) && item.related_record_id);
  const notes = notifications.filter((item) => item.type === "secretary_collection_note" && item.related_record_id);
  for (let offset = 0; offset < payments.length; offset += 100) {
    const group = payments.slice(offset, offset + 100);
    const { data, error } = await supabase.from("payments")
      .select("id,installments!payments_installment_id_fkey(contract_id)")
      .in("id", group.map((item) => item.related_record_id!));
    if (error) throw new Error("Não foi possível carregar os vínculos das notificações.");
    for (const payment of (data ?? []) as unknown as { id: string; installments: { contract_id: string } | null }[]) {
      if (!payment.installments) continue;
      for (const item of group.filter((item) => item.related_record_id === payment.id))
        links.set(item.id, `/advogada/contratos/${payment.installments.contract_id}#pagamento-${payment.id}`);
    }
  }
  for (let offset = 0; offset < notes.length; offset += 100) {
    const group = notes.slice(offset, offset + 100);
    const { data, error } = await supabase.from("collection_notes").select("id,contract_id")
      .in("id", group.map((item) => item.related_record_id!));
    if (error) throw new Error("Não foi possível carregar os vínculos das notificações.");
    for (const note of data ?? []) {
      if (!note.contract_id) continue;
      for (const item of group.filter((item) => item.related_record_id === note.id))
        links.set(item.id, `/advogada/contratos/${note.contract_id}#cobranca-${note.id}`);
    }
  }
  return links;
}
