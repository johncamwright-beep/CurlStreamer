import { expect, it } from "vitest";
import { sampleEvent } from "./event";
import { reportMisses } from "./report-misses";
import { currentShots } from "./model";
it("uses classified non-excluded outcomes and keeps untagged misses in the denominator", () => {
  const e = sampleEvent("shorty-example");
  const all = e.games.flatMap((g) => currentShots(g.state.events));
  const classified = all.filter((s) => !s.excluded && s.execution !== null);
  const missed = classified.filter((s) => s.execution !== "Make");
  const m = reportMisses(e);
  expect(m.classified).toBe(classified.length);
  expect(m.misses).toBe(missed.length);
  expect(m.rate).toBe(
    Math.round((missed.length / classified.length) * 1000) / 10,
  );
  expect(m.categories.reduce((n, c) => n + c.count, 0)).toBe(m.tagged);
  expect(
    m.categories.reduce((n, c) => n + (c.percent ?? 0), 0) +
      (m.untaggedPercent ?? 0),
  ).toBeCloseTo(100, 0);
});
it("isolates individual patterns and never embeds player identities in team analysis", () => {
  const e = sampleEvent("shorty-example");
  const id = currentShots(e.games[0].state.events)[0].playerId;
  const m = reportMisses(e, id);
  expect(m.classified).toBeLessThan(reportMisses(e).classified);
  expect(JSON.stringify(reportMisses(e))).not.toContain(id);
  expect(m.byGame).toHaveLength(e.games.length);
  expect(m.practice.length).toBeLessThanOrEqual(2);
});
it("does not invent patterns when no outcomes are recorded", () => {
  const m = reportMisses(sampleEvent("practice"));
  expect(m.rate).toBeNull();
  expect(m.practice).toEqual([]);
  expect(m.byShot).toEqual([]);
  expect(m.focus).toMatch(/no classified/);
});
