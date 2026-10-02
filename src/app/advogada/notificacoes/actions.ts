"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(form: FormData) {
  const profile = await requireRole("lawyer");
  const id = String(form.get("notification_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("notifications")
    .update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", profile.id).is("read_at", null);
  if (error) throw new Error("Não foi possível marcar a notificação como lida.");
  revalidatePath("/advogada");
  revalidatePath("/advogada/notificacoes");
}
