import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicSupabaseConfig } from "./config";

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("browser Supabase configuration", () => {
  it("uses direct Next.js-inlinable references for both public values", () => {
    const browser = source("./browser.ts");
    expect(browser).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
    expect(browser).toContain(
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
    expect(browser).not.toMatch(/process\.env\s*\[/);
  });

  it("retains strict public configuration validation", () => {
    expect(() => publicSupabaseConfig(undefined, "key")).toThrow(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_URL",
    );
    expect(() => publicSupabaseConfig("https://example.supabase.co")).toThrow(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("keeps the server secret outside the client import graph", () => {
    const browser = source("./browser.ts");
    const config = source("./config.ts");
    const navigation = source("../../components/AccountNavigation.tsx");
    expect(browser + config + navigation).not.toContain("SUPABASE_SECRET_KEY");
    expect(browser).not.toMatch(/from ["']\.\/admin["']/);
  });

  it("allows landing-page account navigation to fall back safely", () => {
    const navigation = source("../../components/AccountNavigation.tsx");
    expect(navigation).toContain("try {");
    expect(navigation).toContain("catch {");
    expect(navigation).toContain('href={loggedIn ? "/account" : "/login"}');
    expect(navigation).toContain("setLoggedIn(false)");
  });
});
