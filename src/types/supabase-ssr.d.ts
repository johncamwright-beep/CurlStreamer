declare module "@supabase/ssr" {
  import type {
    SupabaseClient,
    SupabaseClientOptions,
  } from "@supabase/supabase-js";
  export type CookieOptions = {
    domain?: string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: boolean | "lax" | "strict" | "none";
    secure?: boolean;
  };
  type Cookie = { name: string; value: string; options?: CookieOptions };
  type Options = {
    cookies: {
      getAll(): Array<{ name: string; value: string }>;
      setAll(cookies: Cookie[]): void;
    };
  };
  export function createBrowserClient<Database = any>(
    url: string,
    key: string,
    options?: SupabaseClientOptions<"public">,
  ): SupabaseClient<Database>;
  export function createServerClient<Database = any>(
    url: string,
    key: string,
    options: Options,
  ): SupabaseClient<Database>;
}
