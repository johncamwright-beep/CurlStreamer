import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "./config";

export function createAdminSupabaseClient() {
  const { url } = publicSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key)
    throw new Error("Missing environment variable: SUPABASE_SECRET_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
