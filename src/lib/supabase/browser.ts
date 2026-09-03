"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "./config";

export function createBrowserSupabaseClient() {
  // These references must remain static so Next.js can inline them in browsers.
  const { url, key } = publicSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return createBrowserClient(url, key);
}
