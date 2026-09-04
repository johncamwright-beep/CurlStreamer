import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(
  new URL("./GameSetupNavigation.tsx", import.meta.url),
  "utf8",
);
const scorer = readFileSync(
  new URL("../app/score/[id]/page.tsx", import.meta.url),
  "utf8",
);
const broadcast = readFileSync(
  new URL("../app/broadcast/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("setup navigation", () => {
  it("uses deterministic authorized and safe destinations", () => {
    expect(navigation).toContain(
      "organizer || accountOperator ? `/games/${id}` : `/join/${id}`",
    );
    expect(navigation).toContain("Back to Game Setup");
    expect(navigation).toContain("Exit Scoring");
    expect(navigation).not.toContain("router.back");
    expect(navigation).not.toContain("history.back");
  });

  it("is present at the top of scorer and broadcast views", () => {
    expect(scorer.indexOf("<GameSetupNavigation")).toBeLessThan(
      scorer.indexOf("<header"),
    );
    expect(broadcast.indexOf("<GameSetupNavigation")).toBeLessThan(
      broadcast.indexOf("<BroadcastCanvas"),
    );
  });
});
