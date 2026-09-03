export function publicSupabaseConfig(url?: string, key?: string) {
  if (!url)
    throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
  if (!key)
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  return { url, key };
}
