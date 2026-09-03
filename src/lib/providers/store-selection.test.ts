import { describe, expect, it } from "vitest";
import { selectStoreProvider } from "./store-selection";

const configuredProduction = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "secret-key",
};

describe("selectStoreProvider", () => {
  it("uses the local provider outside production", () => {
    expect(selectStoreProvider({ NODE_ENV: "development" })).toBe("local");
  });

  it("uses Supabase in production with the current Supabase key names", () => {
    expect(selectStoreProvider(configuredProduction)).toBe("supabase");
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ] as const)("fails closed when %s is missing", (missing) => {
    expect(() =>
      selectStoreProvider({ ...configuredProduction, [missing]: undefined }),
    ).toThrow(`Missing environment variable: ${missing}`);
  });

  it("names an invalid URL without including its value", () => {
    const invalid = "not-a-secret-but-do-not-echo";
    expect(() =>
      selectStoreProvider({
        ...configuredProduction,
        NEXT_PUBLIC_SUPABASE_URL: invalid,
      }),
    ).toThrow("Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL");
    try {
      selectStoreProvider({
        ...configuredProduction,
        NEXT_PUBLIC_SUPABASE_URL: invalid,
      });
    } catch (error) {
      expect(String(error)).not.toContain(invalid);
    }
  });
});
