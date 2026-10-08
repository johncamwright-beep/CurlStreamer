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
  it("aligns two equal cameras near the left safe edge with a larger rail", () => {
    const markup = renderToStaticMarkup(
      <BroadcastCanvas game={game("split")} />,
    );

    expect(markup).toContain('data-camera-count="2"');
    expect(markup.match(/broadcast-camera-panel/g)).toHaveLength(2);
    expect(css).toMatch(
      /grid-template-columns: minmax\(0, 63\.8fr\) minmax\(0, 36\.2fr\)/,
    );
    expect(css).toMatch(/\.broadcast-program-layout[^}]*gap: 0\.8cqw/);
    expect(css).toMatch(
      /\[data-camera-count="2"\][\s\S]*grid-template-columns: repeat\(2, max-content\)/,
    );
    expect(css).toMatch(
      /\[data-camera-count="2"\][\s\S]*justify-content: start/,
    );
  });

  it("keeps every panel exactly 9:16 and safely inside the program", () => {
    expect(css).toMatch(/\.portrait-camera-panel[\s\S]*aspect-ratio: 9 \/ 16/);
    expect(css).toMatch(/\.portrait-camera-panel[\s\S]*overflow: hidden/);
    expect(css).toMatch(/\.broadcast-camera-panel \{\s*height: 100%/);
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

  it("centres a portrait crop for landscape fill and contains full frames", () => {
    expect(css).toMatch(/\.portrait-camera-video[\s\S]*object-fit: contain/);
    expect(css).toMatch(
      /data-source-orientation="landscape"\]\[data-framing="fill"\][\s\S]*object-fit: cover/,
    );
    expect(css).toMatch(/data-framing="contain"\][\s\S]*object-fit: contain/);
  });

  it("uses a minimal divider and enlarges overlay sponsors within the safe deck", () => {
    expect(css).toMatch(/data-camera-count="2"[\s\S]*gap: 2px/);
    expect(css).toMatch(/\.sponsor-frame-bounds-overlay[\s\S]*inset: 12\.5%/);
    expect(css).toMatch(/\.sponsor-fitted-frame[\s\S]*overflow: hidden/);
  });

  it("gives the rail readable scoring and aspect-preserving sponsor space", () => {
    const scaledProperty = (selector: string, property: string) => {
      const rule = css.slice(css.indexOf(selector + " {"));
      const value = rule
        .slice(0, rule.indexOf("}"))
        .match(new RegExp(property + ":\\s*([0-9.]+)cqw"));
      expect(
        value,
        selector + " " + property + " must scale with the canvas",
      ).not.toBeNull();
      return Number(value![1]);
    };
    const padding = scaledProperty(".broadcast-scoreboard", "padding");
    const teamSize = scaledProperty(
      ".broadcast-scoreboard > div:not(:first-child) > strong",
      "font-size",
    );
    const scoreSize = scaledProperty(
      ".broadcast-scoreboard > div:not(:first-child) > span strong",
      "font-size",
    );
    // Preserve broadcast readability at 1080p while scaling proportionally in previews.
    expect((padding * 1920) / 100).toBeCloseTo(14.4, 1);
    expect((teamSize * 1920) / 100).toBeCloseTo(30.72, 1);
    expect((scoreSize * 1920) / 100).toBeCloseTo(48, 1);
    expect((padding * 960) / 100).toBeCloseTo(7.2, 1);
    expect(scoreSize).toBeGreaterThan(teamSize);
    expect(css).toMatch(/\.sponsor-frame-bounds-sidebar[\s\S]*flex: 1 1 auto/);
    expect(css).toMatch(/\.safe-video \{\s*object-fit: contain/);
  });

  it("uses adaptive sponsor frames for wide, square, and portrait artwork", () => {
    expect(css).toMatch(/\.sponsor-frame-bounds[\s\S]*min-height: 0/);
    expect(css).not.toContain("max-height: 370px");
    expect(css).toMatch(/\.sponsor-fitted-frame[\s\S]*max-width: 100%/);
    expect(css).toMatch(/\.sponsor-fitted-frame[\s\S]*max-height: 100%/);
    expect(css).toMatch(/\.sponsor-fitted-image[\s\S]*object-fit: contain/);
  });
});
