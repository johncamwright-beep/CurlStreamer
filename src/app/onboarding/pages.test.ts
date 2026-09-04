import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("first-team account pages", () => {
  it("shows account states with and without an active team", () => {
    const account = source("../account/page.tsx");
    expect(account).toContain("Create your team");
    expect(account).toContain("Open team dashboard");
    expect(account).toContain("account.membership.teamName");
    expect(account).toContain("Return to CurlStreamer");
  });

  it("protects and redirects the dashboard while listing authenticated team games", () => {
    const dashboard = source("../dashboard/page.tsx");
    expect(dashboard).toContain('redirect("/login")');
    expect(dashboard).toContain('redirect("/onboarding")');
    expect(dashboard).toContain("Account access denied");
    expect(dashboard).toContain("listTeamGames(user)");
    expect(dashboard).toContain("TeamGameLinks");
    expect(dashboard).not.toContain(
      "Account-based control from another device is coming next",
    );
    expect(dashboard).toContain("Recently Deleted");
    expect(dashboard).not.toMatch(/\.from\(["']games["']\)/);
  });

  it("keeps a route back to the application throughout onboarding", () => {
    expect(source("./FirstTeamForm.tsx")).toContain("Return to CurlStreamer");
    expect(source("./page.tsx")).toContain("Return to CurlStreamer");
  });
});
