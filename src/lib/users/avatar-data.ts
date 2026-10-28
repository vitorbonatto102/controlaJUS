import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUserAvatarPath, USER_AVATAR_BUCKET } from "./avatar";

type Avatar = { path: string | null; url: string | null };
export type UserAvatars = { ready: boolean; error: boolean; byUser: Map<string, Avatar> };

export async function loadUserAvatars(officeId: string, userIds: string[]): Promise<UserAvatars> {
  const result: UserAvatars = { ready: true, error: false, byUser: new Map() };
  const ids = [...new Set(userIds)];
  if (!ids.length) return result;
  try {
    const supabase = await createClient();
    for (let start = 0; start < ids.length; start += 200) {
      const { data, error } = await supabase.from("profiles").select("id,avatar_path")
        .eq("office_id", officeId).in("id", ids.slice(start, start + 200));
      if (error && ["42703", "PGRST204"].includes(error.code) && /avatar_path/.test(error.message))
        return { ready: false, error: false, byUser: new Map() };
      if (error) { result.error = true; return result; }
      const paths: string[] = [];
      for (const profile of data ?? []) {
        const path = typeof profile.avatar_path === "string" && isUserAvatarPath(profile.avatar_path, officeId, profile.id)
          ? profile.avatar_path : null;
        result.byUser.set(profile.id, { path, url: null });
        if (path) paths.push(path);
      }
      if (!paths.length) continue;
      const { data: signed, error: signError } = await supabase.storage.from(USER_AVATAR_BUCKET).createSignedUrls(paths, 3600);
      if (signError) { result.error = true; continue; }
      const urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
      for (const profile of data ?? []) {
        const avatar = result.byUser.get(profile.id)!;
        if (avatar.path) {
          avatar.url = urls.get(avatar.path) ?? null;
          if (!avatar.url) result.error = true;
        }
      }
    }
  } catch { result.error = true; }
  // An optional picture must never make sign-in or administration unavailable.
  return result;
}
