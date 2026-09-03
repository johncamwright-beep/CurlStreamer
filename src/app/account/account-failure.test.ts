import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("account service failure", () => {
  it("renders the safe accessible fallback on account and dashboard", () => {
    const fallback = source("../../components/AccountServiceUnavailable.tsx");
    expect(fallback).toContain("Account services are temporarily unavailable");
    expect(fallback).toContain("Return to CurlStreamer");
    expect(fallback).toContain("Sign Out");
    expect(fallback).toContain('role="alert"');
    expect(source("./page.tsx")).toContain("if (!result.ok)");
    expect(source("../dashboard/page.tsx")).toContain("if (!result.ok)");
  });

  it("returns a failure result and emits only bounded diagnostic fields", () => {
    const account = source("../../lib/auth/account.ts");
    expect(account).not.toContain("Team membership could not be loaded");
    expect(account).toContain("operation: string");
    expect(account).toContain("{ operation, code, message }");
    expect(account).toContain("slice(0, 160)");
    expect(account).not.toMatch(
      /console\.error\([^\n]*(?:user|query|token|cookie)/i,
    );
  });
});
