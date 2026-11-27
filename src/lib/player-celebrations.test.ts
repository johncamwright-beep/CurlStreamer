import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerCelebration } from "@/components/PlayerCelebration";
import {
  CELEBRATION_TEMPLATES,
  getCelebrationProgress,
  type CelebrationCue,
} from "./player-celebrations";
const cue: CelebrationCue = {
  id: "clip",
  templateId: "lightsaber",
  playerId: "player",
  playerName: "Player",
  headshotUrl: "/private/prepared-head.png",
  startedAt: 1000,
  expiresAt: 7167,
  volume: 0.5,
  muted: false,
};
describe("actual Lightsaber celebration", () => {
  it("exposes the three approved complete source clips", () => {
    expect(CELEBRATION_TEMPLATES).toHaveLength(3);
    expect(CELEBRATION_TEMPLATES[0]).toMatchObject({
      id: "lightsaber",
      label: "Lightsaber",
      durationMs: 6167,
    });
    expect(CELEBRATION_TEMPLATES[1]).toMatchObject({
      id: "cat-dance",
      label: "Cat Dance",
      durationMs: 9700,
    });
    expect(CELEBRATION_TEMPLATES[2]).toMatchObject({
      id: "trump-dance",
      durationMs: 9667,
    });
  });
  it("bounds output by authoritative start and expiry without late replay", () => {
    expect(getCelebrationProgress(cue, 999)).toBeNull();
    expect(getCelebrationProgress(cue, 1000)).toBe(0);
    expect(getCelebrationProgress(cue, 4083.5)).toBe(0.5);
    expect(getCelebrationProgress(cue, 7167)).toBeNull();
    expect(
      getCelebrationProgress({ ...cue, expiresAt: 99999 }, 7167),
    ).toBeNull();
    expect(
      getCelebrationProgress({ ...cue, expiresAt: 4000 }, 4000),
    ).toBeNull();
    expect(getCelebrationProgress(cue, NaN)).toBeNull();
  });
  it("preloads the actual video silently and never exposes the original face before composition", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlayerCelebration, { cue }),
    );
    expect(html).toContain("/celebrations/lightsaber.mp4");
    expect(html).toContain('preload="auto"');
    expect(html).toContain('muted=""');
    expect(html).toContain("object-fit:contain");
    expect(html).not.toContain("data-celebration=");
    expect(html).not.toContain(cue.headshotUrl);
  });
});
