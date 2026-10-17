import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { OFFICE_LOGO_BUCKET } from "./branding";

export type OfficeBrand = { id: string; name: string; logoUrl: string | null; brandingReady: boolean };

// O cache do React vale só para a renderização atual; não compartilha dados entre escritórios.
export const loadOfficeBrand = cache(async (officeId: string): Promise<OfficeBrand> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("offices").select("id,name,logo_path").eq("id", officeId).single();
  if (error || !data) {
    const { data: fallback } = await supabase.from("offices").select("name").eq("id", officeId).single();
    return { id: officeId, name: fallback?.name ?? "Seu escritório", logoUrl: null, brandingReady: false };
  }
  let logoUrl: string | null = null;
  if (typeof data.logo_path === "string") {
    if (/^\/branding\/offices\/[a-z0-9-]+\.(png|jpe?g|webp)$/.test(data.logo_path)) logoUrl = data.logo_path;
    else if (data.logo_path.startsWith(`${officeId}/`)) {
      const { data: signed } = await supabase.storage.from(OFFICE_LOGO_BUCKET).createSignedUrl(data.logo_path, 3600);
      logoUrl = signed?.signedUrl ?? null;
    }
  }
  return { id: data.id, name: data.name, logoUrl, brandingReady: true };
});
