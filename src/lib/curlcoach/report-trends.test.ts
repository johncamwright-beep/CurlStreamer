import { expect, it } from "vitest";
import { sampleEvent } from "./event";
import { reportTrends } from "./report-trends";
import { difficultyIdentity } from "./difficulty";

function fixture() {
  const event = sampleEvent("shorty-example");
  event.games = event.games.slice(0, 3);
  event.games.forEach((g, game) => {
    g.ends = g.ends.slice(0, 4);
    g.state.events = g.state.events.slice(0, 8);
    g.state.events.forEach((e, i) =>
      Object.assign(e.shot!, {
        playerId: "target",
        type: "Draw",
        end: Math.floor(i / 2) + 1,
        grade: game === 0 ? (i < 4 ? 1 : 3) : 4,
        excluded: null,
        deficiency: game === 0 ? "Heavy" : "Make",
      }),
    );
  });
  return event;
}
it("compares actual opening and closing ends, and retains the entire game sequence", () => {
  const trends = reportTrends(fixture(), "target");
  expect(trends.withinGames[0].value).toContain("20.0% (4 graded shots)");
  expect(trends.withinGames[0].value).toContain("60.0% (4 graded shots)");
  expect(trends.withinGames[0].value).toContain("change 40.0");
  const recurring = trends.acrossGames.find(
    (e) => e.id === "trend-miss-Heavy",
  )!;
  expect(recurring.value).toContain("Game 1: 100.0% (8 of 8");
  expect(recurring.value).toContain("Game 2: 0.0% (0 of 8");
  expect(recurring.value).toContain("Game 3: 0.0% (0 of 8");
});
it("does not turn absent observations into improvement, or excluded shots into misses", () => {
  const e = fixture();
  e.games[1].state.events.forEach((x) => (x.shot!.deficiency = null));
  e.games[2].state.events.forEach((x) => (x.shot!.excluded = "Pick"));
  expect(
    reportTrends(e).acrossGames.some((x) => x.id === "trend-miss-Heavy"),
  ).toBe(false);
  expect(reportTrends(e, "absent").strengths).toEqual([]);
});
it("preserves zeros, omits ungraded attempts and limits each highlight category", () => {
  const e = fixture();
  e.games[0].state.events.forEach((x) => (x.shot!.grade = 0));
  e.games[1].state.events.forEach((x) => (x.shot!.grade = null));
  const trends = reportTrends(e);
  expect(
    trends.acrossGames.find((x) => x.id === "trend-shooting-overall")?.value,
  ).toContain("Game 1: 0.0%");
  expect(
    trends.acrossGames.find((x) => x.id === "trend-shooting-overall")?.value,
  ).toContain("Game 2: not assessed");
  for (const group of Object.values(trends))
    expect(group.length).toBeLessThanOrEqual(5);
});
it("distinguishes explicitly assessed zero Enhanced results from unassessed games", () => {
  const e = fixture();
  e.games.forEach((g, index) => {
    g.advancedReady = true;
    g.advancedRecords = g.state.events.map((row) => ({
      shotId: row.shotId,
      identity: difficultyIdentity(row.shot!),
      revision: 1,
      valid: true,
      needsReview: false,
      values: {
        shotSubtype: "straight_draw",
        resultObservations: index === 0 ? ["heavy"] : [],
      },
      assessments: { results: index === 2 ? "not_assessed" : "assessed" },
    }));
  });
  const t = reportTrends(e);
  const row = t.acrossGames.find(
    (r) => r.id === "trend-advanced-results-straight_draw-heavy",
  );
  expect(row?.value).toContain("Game 1: 100.0% (8 of 8");
  expect(row?.value).toContain("Game 2: 0.0% (0 of 8");
  expect(row?.value).toContain("Game 3: not assessed");
});
