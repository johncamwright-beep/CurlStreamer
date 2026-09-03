import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync(
  new URL("./BroadcastOperatorNavigation.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/broadcast/[id]/page.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("Back to Scoring", () => {
  it("is authorized, deterministic, outside the fixed program, and lower-right", () => {
    expect(navigation).toContain("hasScoringAccess(localStorage, id)");
    expect(navigation).toContain("if (!authorized) return null");
    expect(navigation).toContain("href={`/score/${id}`}");
    expect(page.indexOf("<BroadcastOperatorNavigation")).toBeLessThan(
      page.indexOf('data-testid="broadcast-visible-wrapper"'),
    );
    expect(css).toMatch(
      /\.broadcast-operator-navigation[\s\S]*right:[^;]+;[\s\S]*bottom:[^;]+;[\s\S]*min-height: 44px/,
    );
  });
});
