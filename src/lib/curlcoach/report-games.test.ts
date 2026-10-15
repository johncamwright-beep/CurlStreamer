import { expect, it } from "vitest";
import { sampleEvent } from "./event";
import { playerReportGames } from "./report-games";
it("keeps game/player boundaries, zeros, unmeasured categories and separate label denominators", () => {
  const event = sampleEvent("shorty-example");
  event.games = event.games.slice(0, 2);
  const first = event.games[0];
  first.state.events = first.state.events.slice(0, 4);
  first.state.events.forEach((e, i) =>
    Object.assign(e.shot!, {
      playerId: i === 3 ? "other" : "target",
      grade: i === 0 ? 0 : i === 1 ? null : 5,
      excluded: i === 2 ? "Pick" : null,
      type: "Draw",
      turn: "CW C",
      execution: i === 0 ? "Xmiss" : "Make",
      deficiency: "Heavy",
    }),
  );
  event.games[1].state.events = [];
  const result = playerReportGames(event, "target");
  const lookup = (id: string) =>
    result.evidence.find((e) => e.id === id)?.value;
  expect(lookup("game-1-overall")).toBe("0.0%");
  expect(lookup("game-1-type-0")).toBe("Not measured");
  expect(lookup("game-1-execution-0")).toBe("50.0%");
  expect(lookup("game-2-overall")).toBe("Not measured");
  expect(result.games[0].groups.map((g) => g.metrics.length)).toEqual([
    1, 10, 8, 4, 6,
  ]);
  expect(JSON.stringify(result.evidence)).not.toContain("target");
});
