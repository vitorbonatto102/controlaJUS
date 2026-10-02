"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export function createBrowserSupabase() {
  const { url, key } = getSupabaseConfig();
  return createBrowserClient(url, key);
}
