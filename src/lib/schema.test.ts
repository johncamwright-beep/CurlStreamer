import { describe, expect, it } from "vitest";
import { actionSchema, hasSafeSponsorContent } from "./schema";

describe("sponsor content validation", () => {
  it("accepts supported signatures and bundled mock assets", () => {
    expect(hasSafeSponsorContent("/sponsors/community.svg")).toBe(true);
    expect(hasSafeSponsorContent("data:image/jpeg;base64,/9j/AA==")).toBe(true);
    expect(hasSafeSponsorContent("data:image/png;base64,iVBORw0KGgo=")).toBe(
      true,
    );
    expect(
      hasSafeSponsorContent("data:image/webp;base64,UklGRgAAAABXRUJQ"),
    ).toBe(true);
  });

  it("rejects spoofed image content and executable formats", () => {
    expect(hasSafeSponsorContent("data:image/png;base64,PHNjcmlwdD4=")).toBe(
      false,
    );
    expect(
      hasSafeSponsorContent("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    ).toBe(false);
    expect(
      hasSafeSponsorContent("data:text/html;base64,PGgxPkJvb208L2gxPg=="),
    ).toBe(false);
  });
});

describe("scoring action validation", () => {
  const base = {
    type: "score",
    intentId: "10000000-0000-4000-8000-000000000013",
    expectedEnd: 1,
    expectedLastEventId: null,
  };

  it.each([
    { ...base, team: "home", points: 1, blank: false },
    { ...base, team: null, points: 0, blank: true },
  ])("accepts a coherent score payload", (action) => {
    expect(actionSchema.safeParse(action).success).toBe(true);
  });

  it.each([
    { ...base, team: "home", points: 0, blank: false },
    { ...base, team: null, points: 1, blank: false },
    { ...base, team: "away", points: 0, blank: true },
    { ...base, team: null, points: 2, blank: true },
  ])("rejects a contradictory score payload", (action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });
});
