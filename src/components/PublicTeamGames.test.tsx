import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  filterPublicGames,
  PublicTeamGames,
  type PublicGame,
} from "./PublicTeamGames";

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
