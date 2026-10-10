import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  filterPublicGames,
  PublicTeamGames,
  publicGamePlayedDate,
  type PublicGame,
} from "./PublicTeamGames";
const now = Date.parse("2026-10-22T15:00:00Z");

const game = (
  id: string,
  event: string,
  scheduled: string,
  completed: string | null = null,
): PublicGame => ({
  id,
  event,
  event_id: event,
  scheduled,
  completed,
  home: "Home",
  away: "Away",
  number: 1,
  result: null,
  youtube: null,
});
it("combines event and status filters and orders upcoming soonest, results newest", () => {
  const games = [
    game("b", "Orion", "2026-10-02"),
    game("a", "Orion", "2026-10-01"),
    game("c", "Other", "2026-10-01"),
    game("d", "Orion", "2026-09-01", "2026-09-01"),
    game("e", "Orion", "2026-09-02", "2026-09-02"),
  ];
  expect(
    filterPublicGames(games, "upcoming", "Orion").map((g) => g.id),
  ).toEqual(["a", "b"]);
  expect(filterPublicGames(games, "results", "Orion").map((g) => g.id)).toEqual(
    ["e", "d"],
  );
});
it("does not render game categories that the team has hidden", () => {
  const html = renderToStaticMarkup(
    <PublicTeamGames
      now={Date.parse("2026-10-04T15:00:00Z")}
      games={[game("a", "Hidden", "2026-09-01")]}
      upcoming={false}
      results={true}
    />,
  );
  expect(html).not.toContain("Hidden");
  expect(html).not.toContain('value="upcoming"');
});
it("only offers real event records, not standalone game titles", () => {
  const html = renderToStaticMarkup(
    <PublicTeamGames
      games={[
        { ...game("a", "Orion", "2026-10-01"), event_id: "event-1" },
        { ...game("b", "Single Game", "2026-10-02"), event_id: null },
        { ...game("c", "Orion · Game 7", "2026-10-03"), event_id: null },
      ]}
      upcoming
      results
    />,
  );
  expect(html).toContain('<option value="event-1">Orion</option>');
  expect(html).not.toContain("<option>Single Game</option>");
  expect(html).not.toContain("<option>Orion · Game 7</option>");
  expect(
    filterPublicGames(
      [{ ...game("a", "Orion", "2026-10-01"), event_id: "event-1" }],
      "upcoming",
      "event-1",
    ),
  ).toHaveLength(1);
});
it("links an opponent only when its published slug is safe", () => {
  const html = renderToStaticMarkup(
    <PublicTeamGames
      now={Date.parse("2026-10-04T15:00:00Z")}
      games={[
        {
          ...game("a", "Orion", "2026-10-01"),
          opponent_slug: "team-wright",
          opponent_logo: "https://cdn.example/team-wright.png",
        },
        { ...game("b", "Orion", "2026-10-02"), opponent_slug: "bad/slug" },
      ]}
      upcoming
      results
    />,
  );
  expect(html).toContain('href="https://team-wright.curlstreamer.app"');
  expect(html).toContain('src="https://cdn.example/team-wright.png"');
  expect(html).not.toContain("https://bad/slug.curlstreamer.app");
});

it("shows an upcoming game's start in the game's timezone", () => {
  const html = renderToStaticMarkup(
    <PublicTeamGames
      now={now}
      games={[
        {
          ...game("a", "Orion", "2026-10-20T22:30:00Z"),
          timezone: "America/Toronto",
        },
      ]}
      upcoming
      results
    />,
  );
  expect(html).toContain("Oct 20, 2026");
  expect(html).toContain("6:30");
  expect(html).toContain("EDT");
  expect(html).toContain('dateTime="2026-10-20T22:30:00Z"');
});
it("shows a completed game's scheduled start rather than its completion time", () => {
  const html = renderToStaticMarkup(
    <PublicTeamGames
      now={now}
      games={[
        {
          ...game("a", "Orion", "2026-10-20T22:30:00Z", "2026-10-22T01:00:00Z"),
          timezone: "America/Vancouver",
        },
      ]}
      upcoming={false}
      results
    />,
  );
  expect(html).toContain("Oct 20, 2026");
  expect(html).toContain("3:30");
  expect(html).toContain("PDT");
  expect(html).not.toContain("Oct 21, 2026");
});

it("defaults to Recent and includes only the last 14 days through now, newest played first", () => {
  const games = [
    game("edge", "Orion", "2026-10-08T15:00:00Z"),
    game("today", "Orion", "2026-10-22T14:00:00Z"),
    game("old", "Orion", "2026-10-08T14:59:59Z", "2026-10-21T10:00:00Z"),
    game("future", "Orion", "2026-10-22T15:00:01Z"),
    game("fallback", "Orion", "invalid", "2026-10-21T12:00:00Z"),
    { ...game("undated", "Orion", "invalid"), scheduled: null },
  ];
  expect(
    filterPublicGames(games, "recent", "Orion", now).map((g) => g.id),
  ).toEqual(["today", "fallback", "edge"]);
  const html = renderToStaticMarkup(
    <PublicTeamGames games={games} upcoming results now={now} />,
  );
  expect(html).toContain(
    '<option value="recent" selected="">Recent · Last 14 days</option>',
  );
  expect(html).toContain('id="game-today"');
  expect(html).not.toContain('id="game-old"');
  expect(html).not.toContain('id="game-future"');
  expect(
    filterPublicGames(games, "results", "Orion", now).map((g) => g.id),
  ).toContain("old");
});

it("Recent respects each publication flag while preserving event filters", () => {
  const games = [
    game("active", "Orion", "2026-10-22T14:00:00Z"),
    game("result", "Orion", "2026-10-21T14:00:00Z", "2026-10-21T15:00:00Z"),
    game("other", "Other", "2026-10-20T14:00:00Z"),
  ];
  const resultsOnly = renderToStaticMarkup(
    <PublicTeamGames games={games} upcoming={false} results now={now} />,
  );
  expect(resultsOnly).toContain('id="game-result"');
  expect(resultsOnly).not.toContain('id="game-active"');
  const upcomingOnly = renderToStaticMarkup(
    <PublicTeamGames games={games} upcoming results={false} now={now} />,
  );
  expect(upcomingOnly).toContain('id="game-active"');
  expect(upcomingOnly).not.toContain('id="game-result"');
  expect(filterPublicGames(games, "recent", "Orion", now)).toHaveLength(2);
  expect(
    renderToStaticMarkup(
      <PublicTeamGames
        games={games}
        upcoming={false}
        results={false}
        now={now}
      />,
    ),
  ).toBe("");
});

it("uses the completed date only when a valid scheduled played date is absent", () => {
  const fallback = game("fallback", "Orion", "invalid", "2026-10-21T12:00:00Z");
  expect(publicGamePlayedDate(fallback)).toBe(fallback.completed);
  const html = renderToStaticMarkup(
    <PublicTeamGames games={[fallback]} upcoming={false} results now={now} />,
  );
  expect(html).toContain('dateTime="2026-10-21T12:00:00Z"');
  expect(html).toContain("2026-10-21 · Start time not recorded");
});
