"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "./config";

export function createBrowserSupabaseClient() {
  const { url, key } = publicSupabaseConfig();
  return createBrowserClient(url, key);
}
