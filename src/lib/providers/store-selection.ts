export type StoreProvider = "local" | "supabase";

type StoreEnvironment = Record<string, string | undefined>;

const supabaseVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

function requireSupabaseConfiguration(environment: StoreEnvironment) {
  for (const name of supabaseVariables) {
    if (!environment[name]?.trim()) {
      throw new Error(`Missing environment variable: ${name}`);
    }
  }

  try {
    const url = new URL(environment.NEXT_PUBLIC_SUPABASE_URL!);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error();
  } catch {
    throw new Error("Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
}

/** Local persistence is a development fallback, never a production default. */
export function selectStoreProvider(
  environment: StoreEnvironment = process.env,
): StoreProvider {
  if (environment.NODE_ENV !== "production") return "local";

  requireSupabaseConfiguration(environment);
  return "supabase";
}
