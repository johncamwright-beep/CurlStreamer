import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/types";
import { BroadcastCanvas } from "./BroadcastCanvas";

vi.mock("./LiveKitCameraFeed", () => ({
  LiveKitCameraFeed: () => React.createElement("video"),
}));
vi.mock("./DecodedSponsorImage", () => ({
  DecodedSponsorImage: ({
    sponsors,
    desiredIndex,
  }: {
    sponsors: GameState["sponsors"];
    desiredIndex: number;
  }) => React.createElement("img", { src: sponsors[desiredIndex]?.dataUrl }),
}));

const game = {
  id: "sponsor-test",
  config: {
    eventName: "Sponsor Test",
    homeName: "A long home curling club name",
    awayName: "A long away curling club name",
    homeColor: "#000000",
    awayColor: "#ffffff",
    scheduledEnds: 8,
    initialHammer: "home",
    youtubeTitle: "Sponsor test",
    youtubeVisibility: "unlisted",
  },
  createdAt: 0,
  scoreEvents: [],
  layout: "split",
  broadcast: "live",
  status: "active",
  audioMuted: false,
  connections: { "camera-home": true, "camera-away": true, scorer: true },
  claims: {},
  sponsors: [
    { id: "one", name: "One", dataUrl: "/one.png", enabled: true, rotation: 0 },
    { id: "two", name: "Two", dataUrl: "/two.png", enabled: true, rotation: 0 },
  ],
  sponsorMode: {
    active: true,
    style: "fullscreen",
    intervalSeconds: 4,
    startedAt: 1_000,
    rotationOffset: 0,
    paused: false,
    mutedPrevious: false,
    muteDuring: true,
  },
} satisfies GameState;

afterEach(() => vi.restoreAllMocks());

describe("Sidebar sponsor rotation", () => {
  it("continuously advances at the configured interval without an empty frame", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const first = renderToStaticMarkup(<BroadcastCanvas game={game} />);
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const second = renderToStaticMarkup(<BroadcastCanvas game={game} />);

    expect(first).toContain('data-testid="sponsor-sidebar"');
    expect(first).toContain('src="/one.png"');
    expect(second).toContain('data-testid="sponsor-sidebar"');
    expect(second).toContain('src="/two.png"');
    expect(first).not.toContain('data-testid="sponsor-overlay"');
    expect(second).not.toContain('data-testid="sponsor-overlay"');
  });
});
