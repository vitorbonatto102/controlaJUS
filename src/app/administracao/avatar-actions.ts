"use server";

import { revalidatePath } from "next/cache";
import { requireOfficeAdmin } from "@/lib/auth/profile";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";
import { imageFormat } from "@/lib/uploads/image-format";
import { isUserAvatarPath, USER_AVATAR_BUCKET, USER_AVATAR_MAX_BYTES } from "@/lib/users/avatar";

export async function updateUserAvatar(userId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const profile = await requireOfficeAdmin();
  const officeId = profile.office_id!;
  const expectedPath = String(form.get("expected_path") ?? "") || null;
  const intent = form.get("intent");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(userId) ||
    (expectedPath && !isUserAvatarPath(expectedPath, officeId, userId)) || !["upload", "remove"].includes(String(intent)))
    return { error: "Não foi possível identificar a foto deste usuário. Recarregue a página.", success: null };
  const supabase = await createClient();
  const { data: target, error: readError } = await supabase.from("profiles").select("avatar_path")
    .eq("id", userId).eq("office_id", officeId).single();
  if (readError || !target) return { error: "Foto indisponível. Confira o usuário e a atualização do módulo no Supabase.", success: null };
  if (target.avatar_path !== expectedPath)
    return { error: "A foto foi alterada por outra pessoa. Recarregue a página antes de salvar.", success: null };

  let nextPath: string | null = null;
  try {
    if (intent === "upload") {
      const file = form.get("photo");
      if (!(file instanceof File) || !file.size) return { error: "Escolha uma foto para este usuário.", success: null };
      if (file.size > USER_AVATAR_MAX_BYTES) return { error: "A foto deve ter até 2 MB.", success: null };
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = imageFormat(bytes);
      if (!format || file.type !== format.mime) return { error: "Envie uma imagem PNG, JPG ou WebP válida.", success: null };
      nextPath = `${officeId}/${userId}/${crypto.randomUUID()}.${format.extension}`;
      const { error } = await supabase.storage.from(USER_AVATAR_BUCKET).upload(nextPath, bytes,
        { contentType: format.mime, upsert: false, cacheControl: "3600" });
      if (error) return { error: "Não foi possível enviar a foto. Tente novamente.", success: null };
    }
    const { error } = await supabase.rpc("set_user_avatar", {
      p_user: userId, p_avatar_path: nextPath, p_expected_path: expectedPath,
    });
    if (error) {
      if (nextPath) await supabase.storage.from(USER_AVATAR_BUCKET).remove([nextPath]);
      return { error: error.code === "P0001" ? error.message : "Não foi possível salvar a foto. Tente novamente.", success: null };
    }
  } catch {
    // If the RPC committed before a network failure, Storage protects the file in use.
    if (nextPath) await supabase.storage.from(USER_AVATAR_BUCKET).remove([nextPath]).catch(() => undefined);
    return { error: "O envio não pôde ser concluído. Recarregue para conferir a foto e tente novamente.", success: null };
  }
  // The prior file is removed only after the new reference is committed.
  if (expectedPath) await supabase.storage.from(USER_AVATAR_BUCKET).remove([expectedPath]).catch(() => undefined);
  revalidatePath("/", "layout");
  return { error: null, success: nextPath ? "Foto do usuário atualizada." : "Foto removida. As iniciais serão exibidas." };
}
