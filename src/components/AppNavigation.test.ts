import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(
  new URL("./AppNavigation.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const camera = readFileSync(
  new URL("../app/camera/[id]/[role]/page.tsx", import.meta.url),
  "utf8",
);
const broadcast = readFileSync(
  new URL("../app/broadcast/[id]/page.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("shared application navigation", () => {
  it("shows only existing signed-in or signed-out account destinations", () => {
    expect(navigation).toContain(
      '{ href: "/dashboard", label: "Games", icon: "game" }',
    );
    expect(navigation).toContain(
      '{ href: "/games/new", label: "Schedule a game", icon: "calendar" }',
    );
    expect(navigation).toContain(
      '{ href: "/account", label: "Account", icon: "account" }',
    );
    expect(navigation).toContain(
      '{ href: "/login", label: "Sign in", icon: "account" }',
    );
    expect(navigation).toContain("{signedIn ? (");
    expect(navigation).toContain(
      '{ href: "/seasons", label: "Seasons & events", icon: "list" }',
    );
    expect(navigation).toContain(
      '{ href: "/opponents", label: "Opponents", icon: "opponent" }',
    );
    expect(navigation).not.toMatch(/Administration|YouTube/);
    expect(home).not.toContain("AppNavigation");
    expect(home).toContain('<AuthForm mode="login" action={login} />');
    expect(navigation).toContain("createBrowserSupabaseClient");
  });

  it("derives deterministic game links from existing token access helpers", () => {
    expect(navigation).toContain("hasOrganizerAccess(localStorage, gameId)");
    expect(navigation).toContain("readCurrentGame(localStorage)");
    expect(navigation).toContain("hasScoringAccess(localStorage, gameId)");
    expect(navigation).toContain("href: `/games/${current.id}`");
    expect(navigation).toContain("href: `/score/${current.id}`");
    expect(navigation).toContain("href: `/broadcast/${current.id}`");
    expect(navigation).toContain('current.access === "organizer"');
    expect(navigation).toContain('? "scorer"');
  });

  it("has accessible disclosure, dismissal, focus trapping, and scroll locking", () => {
    expect(navigation).toContain('aria-label={open ? "Close navigation menu"');
    expect(navigation).toContain("aria-expanded={open}");
    expect(navigation).toContain("aria-controls={panelId}");
    expect(navigation).toContain('event.key === "Escape"');
    expect(navigation).toContain('event.key !== "Tab"');
    expect(navigation).toContain('document.body.style.overflow = "hidden"');
    expect(css).toMatch(
      /app-navigation-trigger[\s\S]*width: 44px;[\s\S]*height: 44px;/,
    );
    expect(css).toContain("focus-visible");
    expect(css).toContain("calc(100vw - 2rem)");
  });

  it("excludes cameras and keeps authorized operator UI outside program output", () => {
    expect(camera).not.toContain("AppNavigation");
    expect(broadcast).toContain("hasScoringAccess(localStorage, id)");
    expect(broadcast.indexOf("<AppNavigation")).toBeLessThan(
      broadcast.indexOf('data-testid="broadcast-visible-wrapper"'),
    );
    expect(broadcast.indexOf("<BroadcastOperatorNavigation")).toBeLessThan(
      broadcast.indexOf('data-testid="broadcast-visible-wrapper"'),
    );
    expect(broadcast).toContain("<BroadcastCanvas game={game} />");
    expect(css).toMatch(
      /broadcast-fixed-canvas[\s\S]*width: 1920px;[\s\S]*height: 1080px;/,
    );
  });
});
