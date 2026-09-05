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
const gameControl = readFileSync(
  new URL("../app/games/[id]/page.tsx", import.meta.url),
  "utf8",
);
const scoring = readFileSync(
  new URL("../app/score/[id]/page.tsx", import.meta.url),
  "utf8",
);
const editSchedule = readFileSync(
  new URL("../app/games/[id]/edit/page.tsx", import.meta.url),
  "utf8",
);
const gameLinks = readFileSync(
  new URL("./TeamGameLinks.tsx", import.meta.url),
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
    expect(navigation).toContain('href: "/settings/youtube"');
    expect(navigation).toContain('label: "YouTube Settings"');
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
    expect(navigation).not.toMatch(/Administration/);
    expect(home).not.toContain("AppNavigation");
    expect(home).toContain('<AuthForm mode="login" action={login} />');
    expect(navigation).toContain("createBrowserSupabaseClient");
  });

  it("synchronizes persistent current-game capability links", () => {
    expect(navigation).toContain("readCurrentGame(localStorage)");
    expect(navigation).toContain(
      "selectCurrentGame(localStorage, synchronized)",
    );
    expect(navigation).toContain("CURRENT_GAME_EVENT");
    expect(navigation).toContain("href: `/games/${current.id}`");
    expect(navigation).toContain("href: `/score/${current.id}`");
    expect(navigation).toContain("href: `/broadcast/${current.id}`");
    expect(navigation).toContain("current.capabilities.assignOpponent");
    expect(navigation).toContain("current.capabilities.editSchedule");
  });

  it("selects every hub action and synchronizes direct game routes", () => {
    expect(gameLinks).toContain("selectCurrentGame(localStorage");
    for (const action of [
      "Open Game",
      "Edit Schedule",
      "Assign Opponent",
      "Scoring",
      "Broadcast",
    ])
      expect(gameLinks).toContain(action);
    for (const route of [gameControl, scoring, broadcast, editSchedule]) {
      expect(route).toContain("gameContext={{");
      expect(route).toContain("gameCapabilities(");
    }
  });

  it("has accessible disclosure, dismissal, focus trapping, and scroll locking", () => {
    expect(navigation).toContain('aria-label={open ? "Close navigation menu"');
    expect(navigation).toContain("useState(false)");
    expect(navigation).toContain("aria-expanded={open}");
    expect(navigation).toContain("inert={!open ? true : undefined}");
    expect(navigation).toContain("aria-controls={panelId}");
    expect(navigation).toContain('event.key === "Escape"');
    expect(navigation).toContain('event.key !== "Tab"');
    expect(navigation).toContain('document.body.style.overflow = "hidden"');
    expect(css).toMatch(
      /app-navigation-trigger[\s\S]*width: 44px;[\s\S]*height: 44px;/,
    );
    expect(css).toContain("focus-visible");
    expect(css).toContain("calc(100vw - 2rem)");
    expect(css).toContain("transform: translateX(-105%)");
    expect(css).not.toContain("@media (min-width: 1024px)");
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
