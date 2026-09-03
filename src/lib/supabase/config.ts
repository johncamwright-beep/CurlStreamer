export function publicSupabaseConfig(environment = process.env) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const key = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url)
    throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
  if (!key)
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  return { url, key };
}
