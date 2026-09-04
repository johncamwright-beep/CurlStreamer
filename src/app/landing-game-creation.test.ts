import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("account-based landing and game creation", () => {
  it("uses the shared sign-in form at root and login without navigation", () => {
    const home = source("./page.tsx");
    const login = source("./login/page.tsx");
    const authForm = source("../components/AuthForm.tsx");
    expect(home).toContain('redirect("/dashboard")');
    expect(home).toContain('<AuthForm mode="login" action={login} />');
    expect(home).not.toContain("GameCreationForm");
    expect(home).not.toContain("AppNavigation");
    expect(login).toContain(
      '<AuthForm mode="login" action={login} returnTo={next} />',
    );
    expect(authForm).toContain("Create Account");
    expect(authForm).not.toContain("AppNavigation");
  });

  it("protects the new-game page and preserves organizer-token storage", () => {
    const page = source("./games/new/page.tsx");
    const form = source("./games/new/GameCreationForm.tsx");
    expect(page).toContain('redirect("/login?next=%2Fgames%2Fnew")');
    expect(page).toContain('redirect("/onboarding")');
    expect(page).toContain('team.kind === "inactive"');
    expect(page).toContain('team.kind === "unavailable"');
    expect(page).toContain('team.team.role === "viewer"');
    expect(form).toContain('fetch("/api/games"');
    expect(form).toContain("localStorage.setItem(`curlcast-access-${game.id}`");
  });
});
