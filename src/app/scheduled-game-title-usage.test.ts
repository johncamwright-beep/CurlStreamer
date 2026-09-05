import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("canonical scheduled game title usage", () => {
  it.each([
    "src/app/dashboard/GamesDashboard.tsx",
    "src/app/events/[id]/page.tsx",
    "src/app/games/[id]/edit/page.tsx",
  ])("formats structured listings and schedule headings in %s", (path) => {
    expect(source(path)).toContain("formatCanonicalGameTitle");
  });

  it.each(["src/app/games/[id]/page.tsx", "src/app/score/[id]/page.tsx"])(
    "formats live game context in %s",
    (path) => {
      expect(source(path)).toContain("canonicalTitleFromConfig");
    },
  );

  it("uses canonical titles in game action accessibility labels", () => {
    const links = source("src/components/TeamGameLinks.tsx");
    for (const action of ["Open Game", "Edit game", "Broadcast"])
      expect(links).toContain(`aria-label={\`${action}: \${title}\`}`);
  });

  it("keeps the broadcast rail to the event snapshot or Single Game", () => {
    expect(source("src/components/BroadcastCanvas.tsx")).toContain(
      "formatBroadcastRailTitle(game.config.eventName)",
    );
  });
});
