import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/types";
import { BroadcastCanvas } from "./BroadcastCanvas";

vi.mock("./LiveKitCameraFeed", () => ({
  LiveKitCameraFeed: () => React.createElement("video"),
}));
vi.mock("./Scoreboard", () => ({
  Scoreboard: () => React.createElement("div", null, "Scoreboard"),
}));

const game = (layout: GameState["layout"]): GameState => ({
  id: "layout-test",
  config: {
    eventName: "Layout Test Bonspiel",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#06b6d4",
    awayColor: "#f43f5e",
    scheduledEnds: 8,
    initialHammer: "home",
    youtubeTitle: "Layout test",
    youtubeVisibility: "unlisted",
  },
  createdAt: 0,
  scoreEvents: [],
  layout,
  broadcast: "live",
  status: "active",
  audioMuted: true,
  connections: { "camera-home": true, "camera-away": true, scorer: true },
  claims: {},
  sponsors: [],
  sponsorMode: {
    active: false,
    style: "overlay",
    intervalSeconds: 30,
    startedAt: null,
    rotationOffset: 0,
    paused: false,
    mutedPrevious: false,
    muteDuring: false,
  },
});

const css = fs.readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("1920x1080 broadcast video layout", () => {
  it("allocates the dominant 73% program region to two equal cameras", () => {
    const markup = renderToStaticMarkup(
      <BroadcastCanvas game={game("split")} />,
    );

    expect(markup).toContain('data-camera-count="2"');
    expect(markup.match(/broadcast-camera-panel/g)).toHaveLength(2);
    expect(css).toMatch(
      /grid-template-columns: minmax\(0, 73fr\) minmax\(0, 25fr\)/,
    );
    expect(css).toMatch(
      /\[data-camera-count="2"\][\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it("keeps every panel exactly 9:16 and safely inside the program", () => {
    expect(css).toMatch(/\.portrait-camera-panel[\s\S]*aspect-ratio: 9 \/ 16/);
    expect(css).toMatch(/\.portrait-camera-panel[\s\S]*overflow: hidden/);
    expect(css).toMatch(/\.broadcast-camera-panel \{\s*height: 92%/);
    expect(css).not.toMatch(/\.broadcast-camera-panel[^}]*\bwidth:/);
    expect(css).not.toMatch(/\.broadcast-camera-panel[^}]*max-width:/);
  });

  it("enlarges a single selected camera to the safe-area height", () => {
    const markup = renderToStaticMarkup(
      <BroadcastCanvas game={game("home")} />,
    );

    expect(markup).toContain('data-camera-count="1"');
    expect(markup.match(/broadcast-camera-panel/g)).toHaveLength(1);
    expect(css).toMatch(
      /\[data-camera-count="1"\] \.broadcast-camera-panel \{\s*height: 100%/,
    );
  });

  it("contains camera pixels without a crop or stretch fallback", () => {
    expect(css).toMatch(/\.portrait-camera-video[\s\S]*object-fit: contain/);
    expect(css).not.toContain("object-fit: cover");
    expect(css).not.toContain("portrait-camera-video--landscape");
  });
});
