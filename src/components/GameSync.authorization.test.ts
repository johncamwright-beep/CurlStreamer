import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("useGame authorization forwarding", () => {
  it("forwards the stored bearer credential during ordinary refreshes", () => {
    const source = readFileSync("src/components/GameSync.tsx", "utf8");
    expect(source).toContain("curlcast-access-${id}");
    expect(source).toContain("authorization: `Bearer ${token}`");
    expect(source.indexOf("const token")).toBeLessThan(
      source.indexOf('cache: "no-store"'),
    );
  });
});
