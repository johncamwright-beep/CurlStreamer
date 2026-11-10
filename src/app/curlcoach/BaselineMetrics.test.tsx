import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { expect, it, vi } from "vitest";
import BaselineMetrics from "./BaselineMetrics";
import { sampleEvent, type Workspace } from "@/lib/curlcoach/event";

vi.stubGlobal("React", React);
it("uses a selected game's event and ignores uncharted future events for the latest comparison", () => {
  const event = sampleEvent("shorty-example");
  event.games = event.games.slice(0, 3).map((game, i) => ({
    ...game,
    id: `game-${i}`,
    eventId: `event-${i}`,
    scheduledStart: `2026-0${i + 1}-01`,
    state: i === 2 ? { ...game.state, events: [] } : game.state,
  }));
  const workspace: Workspace = {
    event,
    refreshedAt: "2026-03-01",
    catalog: event.games.map((game, i) => ({
      id: game.eventId!,
      name: `Event scope ${i}`,
      seasonId: event.seasonId,
      startDate: game.scheduledStart,
    })),
  };
  const selected = renderToStaticMarkup(
    <BaselineMetrics workspace={workspace} eventId="all" gameId="game-0" />,
  );
  expect(selected).toContain("Event scope 0");
  expect(selected).not.toContain("Event scope 1");
  const latest = renderToStaticMarkup(
    <BaselineMetrics workspace={workspace} eventId="all" gameId="all" />,
  );
  expect(latest).toContain("Event scope 1");
  expect(latest).not.toContain("Event scope 2");
});
