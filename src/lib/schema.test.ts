import { describe, expect, it } from "vitest";
import { actionSchema, gameSchema, hasSafeSponsorContent } from "./schema";

it("round-trips saved games with empty or shared watch links", () => {
  const base = {
    eventName: "Winter event",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#000000",
    awayColor: "#ffffff",
    scheduledEnds: 8,
    youtubeTitle: "Winter game",
    youtubeVisibility: "unlisted",
  };
  for (const sharedYoutubeWatchUrl of [
    undefined,
    null,
    "",
    "https://youtu.be/abcdefghijk",
  ]) {
    const saved = gameSchema.parse({ ...base, sharedYoutubeWatchUrl });
    expect(gameSchema.parse(saved)).toEqual(saved);
  }
  expect(
    gameSchema.safeParse({
      ...base,
      youtubeEnabled: true,
      sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
    }).success,
  ).toBe(false);
});

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

describe("camera hardware zoom validation", () => {
  it("requires a complete, bounded phone capability report", () => {
    expect(
      actionSchema.safeParse({
        type: "camera-zoom-status",
        role: "camera-home",
        supported: true,
        min: 1,
        max: 4,
        step: 0.1,
        value: 2,
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: "camera-zoom-status",
        role: "camera-home",
        supported: true,
      }).success,
    ).toBe(false);
  });
});

describe("camera microphone actions", () => {
  it("accepts bounded operator intent and phone-only status values", () => {
    expect(
      actionSchema.safeParse({
        type: "camera-audio",
        role: "camera-home",
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: "camera-audio-status",
        role: "camera-home",
        status: "permission-required",
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: "camera-audio-status",
        role: "scorer",
        status: "active",
      }).success,
    ).toBe(false);
  });
});
