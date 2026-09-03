import { describe, expect, it } from "vitest";
import type { GameState } from "./types";
import {
  hasVisibleSponsorOverlay,
  isScorerAudioEffectivelyMuted,
} from "./sponsor-audio";

function game(
  style: GameState["sponsorMode"]["style"],
  active: boolean,
  manualMute = false,
): GameState {
  return {
    id: "audio-test",
    config: {
      eventName: "Audio test",
      homeName: "Home",
      awayName: "Away",
      homeColor: "#000000",
      awayColor: "#ffffff",
      scheduledEnds: 8,
      initialHammer: "home",
      youtubeTitle: "Audio test",
      youtubeVisibility: "unlisted",
    },
    createdAt: 0,
    scoreEvents: [],
    layout: "split",
    broadcast: "live",
    status: "active",
    audioMuted: manualMute,
    connections: { "camera-home": true, "camera-away": true, scorer: true },
    claims: {},
    sponsors: [
      {
        id: "sponsor",
        name: "Sponsor",
        dataUrl: "/sponsors/community.svg",
        enabled: true,
        rotation: 0,
      },
    ],
    sponsorMode: {
      active,
      style,
      intervalSeconds: 4,
      startedAt: 0,
      rotationOffset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
}

describe("sponsor audio state", () => {
  it("never automatically mutes for active Sidebar rotation", () => {
    const sidebar = game("fullscreen", true);
    expect(hasVisibleSponsorOverlay(sidebar)).toBe(false);
    expect(isScorerAudioEffectivelyMuted(sidebar)).toBe(false);
  });

  it("mutes only while an enabled Overlay sponsor is visible", () => {
    const overlay = game("overlay", true);
    expect(hasVisibleSponsorOverlay(overlay)).toBe(true);
    expect(isScorerAudioEffectivelyMuted(overlay)).toBe(true);

    overlay.sponsorMode.active = false;
    expect(isScorerAudioEffectivelyMuted(overlay)).toBe(false);
    overlay.sponsorMode.active = true;
    overlay.sponsorMode.style = "fullscreen";
    expect(isScorerAudioEffectivelyMuted(overlay)).toBe(false);
  });

  it("keeps an explicit manual mute after Overlay closes or changes mode", () => {
    const overlay = game("overlay", true, true);
    expect(isScorerAudioEffectivelyMuted(overlay)).toBe(true);
    overlay.sponsorMode.active = false;
    expect(isScorerAudioEffectivelyMuted(overlay)).toBe(true);
    overlay.sponsorMode.style = "fullscreen";
    expect(isScorerAudioEffectivelyMuted(overlay)).toBe(true);
  });
});
