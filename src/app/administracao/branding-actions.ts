"use server";

import { revalidatePath } from "next/cache";
import { requireOfficeAdmin } from "@/lib/auth/profile";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";
import { OFFICE_LOGO_BUCKET, OFFICE_LOGO_MAX_BYTES, officeLogoFormat } from "@/lib/offices/branding";

export async function updateOfficeLogo(_state: ActionState, form: FormData): Promise<ActionState> {
  const profile = await requireOfficeAdmin();
  const supabase = await createClient();
  const { data: office, error: officeError } = await supabase.from("offices")
    .select("logo_path").eq("id", profile.office_id).single();
  if (officeError || !office) return { error: "A personalização do escritório ainda não está disponível. Contate o administrador da plataforma.", success: null };

  let nextPath: string | null = null;
  if (form.get("intent") !== "remove") {
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0)
      return { error: "Escolha uma imagem para o escritório.", success: null };
    if (file.size > OFFICE_LOGO_MAX_BYTES)
      return { error: "A imagem deve ter até 2 MB.", success: null };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = officeLogoFormat(bytes);
    if (!format || file.type !== format.mime)
      return { error: "Envie uma imagem PNG, JPG ou WebP válida.", success: null };
    nextPath = `${profile.office_id}/${crypto.randomUUID()}.${format.extension}`;
    const { error } = await supabase.storage.from(OFFICE_LOGO_BUCKET).upload(nextPath, bytes,
      { contentType: format.mime, upsert: false });
    if (error) return { error: "Não foi possível enviar a imagem. Tente novamente.", success: null };
  }

  const { error } = await supabase.rpc("set_office_logo", { p_logo_path: nextPath });
  if (error) {
    if (nextPath) await supabase.storage.from(OFFICE_LOGO_BUCKET).remove([nextPath]);
    return { error: "Não foi possível salvar o logo do escritório. Tente novamente.", success: null };
  }
  // O arquivo anterior só é removido depois de confirmar a nova referência.
  if (typeof office.logo_path === "string" && office.logo_path.startsWith(`${profile.office_id}/`))
    await supabase.storage.from(OFFICE_LOGO_BUCKET).remove([office.logo_path]);
  revalidatePath("/", "layout");
  return { error: null, success: nextPath ? "Logo atualizado para toda a equipe." : "Logo removido. O escritório será identificado pelo nome e pelas iniciais." };
}
