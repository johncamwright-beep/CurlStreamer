import { expect, it } from "vitest";
import { eventShots, sampleEvent } from "./event";
import {
  defaultShotFilters,
  filterAnalysisShots,
  missBreakdown,
} from "./analysis";

it("separates share of misses from frequency of diagnosed shots without guessing missing diagnoses", () => {
  const shot = eventShots(sampleEvent("shorty-example"))[0];
  const rows = ["Light", "Heavy", "Make", "Make", null].map(
    (deficiency) =>
      ({ ...shot, excluded: null, grade: 0, deficiency }) as typeof shot,
  );
  rows.push({ ...shot, excluded: "Pick", grade: null, deficiency: "Light" });
  const light = missBreakdown(rows).find((r) => r.label === "Light")!;
  expect(light).toEqual({ label: "Light", count: 1, share: 50, frequency: 25 });
  expect(missBreakdown([])[0]).toMatchObject({ share: null, frequency: null });
});
it("filters shots using the situation before the end and excludes unknown situations", () => {
  const event = sampleEvent("shorty-example");
  const game = event.games[0];
  game.initialHammer = game.side;
  game.ends = [
    { end: 1, us: 2, them: 0, hammer: false },
    { end: 2, us: 0, them: 1, hammer: true },
  ];
  const base = eventShots(event)[0];
  const shots = [1, 2, 3].map((end) => ({ ...base, gameId: game.id, end }));
  expect(
    filterAnalysisShots(shots, [game], {
      ...defaultShotFilters,
      hammer: "with",
      margin: "0",
    }).map((s) => s.end),
  ).toEqual([1]);
  expect(
    filterAnalysisShots(shots, [game], {
      ...defaultShotFilters,
      hammer: "without",
      margin: "2",
    }).map((s) => s.end),
  ).toEqual([2]);
  expect(
    filterAnalysisShots(shots, [game], {
      ...defaultShotFilters,
      hammer: "with",
    }).map((s) => s.end),
  ).toEqual([1]);
  expect(filterAnalysisShots(shots, [game], defaultShotFilters)).toHaveLength(
    3,
  );
});
