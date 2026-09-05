import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("useGame authorization forwarding", () => {
  it("delegates ordinary and Broadcast refresh credential selection", () => {
    const source = readFileSync("src/components/GameSync.tsx", "utf8");
    expect(source).toContain("fetchGameWithSelectedAccess(");
  });

  it("clears a matching device-local game after a completed response", () => {
    const source = readFileSync("src/components/GameSync.tsx", "utf8");
    expect(source).toContain("clearCurrentGameIfMatching(localStorage, id)");
    expect(source.indexOf('nextLifecycle === "completed"')).toBeLessThan(
      source.indexOf("clearCurrentGameIfMatching(localStorage, id)"),
    );
  });
});
