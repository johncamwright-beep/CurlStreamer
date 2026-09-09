import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");

describe("Game Control camera release", () => {
  it("refreshes claim state immediately and distinguishes live disconnect from offline release", () => {
    expect(page).toContain("await refresh()");
    expect(page).toContain('"Disconnect camera"');
    expect(page).toContain('"Release camera"');
    expect(page).toContain('"Connecting", "Live", "Reconnecting"');
  });
});
