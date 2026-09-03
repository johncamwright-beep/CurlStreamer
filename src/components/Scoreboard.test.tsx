import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameState, Team } from "@/lib/types";
import { Scoreboard } from "./Scoreboard";

function game(hammer: Team | null): GameState {
  return {
    id: "game",
    config: {
      eventName: "Final",
      homeName: "Granite",
      awayName: "Glaciers",
      homeColor: "#ff0000",
      awayColor: "#0000ff",
      scheduledEnds: 8,
      youtubeTitle: "Final",
      youtubeVisibility: "unlisted",
    },
    createdAt: 1,
    scoreEvents: hammer
      ? [{ id: "h", at: 1, type: "hammer", team: hammer }]
      : [],
    layout: "split",
    broadcast: "idle",
    status: "active",
    audioMuted: false,
    connections: { "camera-home": false, "camera-away": false, scorer: false },
    claims: {},
    sponsors: [],
    sponsorMode: {
      active: false,
      style: "fullscreen",
      intervalSeconds: 4,
      startedAt: null,
      rotationOffset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
}

describe("hammer scoreboard indicator", () => {
  it.each([
    ["home", "Granite"],
    ["away", "Glaciers"],
  ] as const)("renders an accessible SVG for %s", (team, name) => {
    const markup = renderToStaticMarkup(<Scoreboard game={game(team)} />);
    expect(markup).toContain(`<svg`);
    expect(markup).toContain(`aria-label="${name} has hammer"`);
    expect(markup).not.toContain("HAMMER ·");
  });

  it("does not show an indicator while hammer is unassigned", () => {
    expect(
      renderToStaticMarkup(<Scoreboard game={game(null)} />),
    ).not.toContain("has hammer");
  });
});
