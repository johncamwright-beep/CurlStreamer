import { beforeEach, expect, it, vi } from "vitest";
import { eventShots, sampleEvent } from "@/lib/curlcoach/event";
import { analysisEventShots } from "@/lib/curlcoach/advanced-analysis";
import { currentShots } from "@/lib/curlcoach/model";
import { emptySupplement } from "@/lib/curlcoach/enhanced-catalog";
const mocks = vi.hoisted(() => ({ load: vi.fn(), local: vi.fn() }));
vi.mock("./shot-tracker-enhanced", () => ({ loadEnhanced: mocks.load }));
vi.mock("./curlcoach-local", () => ({ readLocalEnhanced: mocks.local }));
import { loadEventDifficulty } from "./shot-tracker-difficulty";
beforeEach(() => vi.resetAllMocks());
it("uses authorized organization, actor and game scopes and exposes only sanitized analysis", async () => {
  const event = sampleEvent("shorty-example");
  mocks.load.mockImplementation(async (_scope, state) =>
    currentShots(state.events).map((s) => {
      const value = emptySupplement();
      value.values.difficulty = "demanding";
      value.values.intendedWeight = "button";
      value.values.resultObservations = [];
      value.assessments.results = "assessed";
      value.values.instruction = "private instruction";
      return {
        kind: "supplement",
        shotId: s.id,
        revision: 1,
        sourceRevision: state.events.find(
          (e: { shotId: string }) => e.shotId === s.id,
        ).revision,
        value,
        at: "now",
      };
    }),
  );
  await loadEventDifficulty(event, "coach");
  expect(mocks.load).toHaveBeenCalledTimes(event.games.length);
  for (const g of event.games) {
    expect(mocks.load).toHaveBeenCalledWith(
      {
        organizationId: event.organizationId,
        actorUserId: "coach",
        gameId: g.id,
      },
      g.state,
    );
    expect(g.difficultyReady).toBe(true);
    expect(g.analysisReady).toBe(true);
    expect(g.analysisRecords?.[0]).toMatchObject({
      intendedWeight: "button",
      resultObservations: [],
      resultAssessment: "assessed",
    });
    expect(JSON.stringify(g.analysisRecords)).not.toMatch(
      /private|instruction|values|contextSnapshot/,
    );
    expect(g.difficultyRecords?.[0].level).toBe("B");
    expect(JSON.stringify(g.difficultyRecords)).not.toMatch(
      /note|assessments|values/,
    );
  }
});
it("isolates failed games while preserving all traditional data", async () => {
  const event = sampleEvent("shorty-example"),
    before = structuredClone(event.games.map((g) => g.state));
  mocks.load.mockResolvedValue([]).mockRejectedValueOnce(new Error("offline"));
  await loadEventDifficulty(event, "coach");
  expect(event.games[0].difficultyReady).toBe(false);
  expect(event.games[0].analysisReady).toBe(false);
  expect(event.games[0].analysisRecords).toEqual([]);
  expect(event.games[1].difficultyReady).toBe(true);
  expect(event.games[1].analysisReady).toBe(true);
  expect(analysisEventShots(event).length).toBe(eventShots(event).length);
  expect(analysisEventShots(event)[0].analysisUnavailable).toBe(true);
  expect(event.games.map((g) => g.state)).toEqual(before);
});
it("reads synthetic documents only through the local path", async () => {
  const event = sampleEvent("practice");
  mocks.local.mockReturnValue([]);
  await loadEventDifficulty(event, "synthetic-coach", true);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.local).toHaveBeenCalledWith(
    event.games[0].state,
    "synthetic-coach",
  );
});
