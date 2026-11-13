import { describe, expect, it } from "vitest";
import {
  append,
  commandSchema,
  currentShots,
  emptyState,
  report,
  shotSchema,
  type Shot,
} from "./model";
const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Partial",
  grade: 5,
  deficiency: null,
  review: null,
  excluded: null,
  note: "",
};
const command = (grade: number | null = 5) => ({
  requestId: crypto.randomUUID(),
  expectedRevision: 0,
  shotId: crypto.randomUUID(),
  shot: { ...shot, grade },
});
describe("provisional tracker calculations", () => {
  it("uses numeric zero, ignores missing and excluded grades, and preserves independent execution", () => {
    expect(
      report([5, 4, 3, 2, 1, 0].map((grade) => ({ ...shot, grade }))).percent,
    ).toBe(50);
    expect(
      report([
        { ...shot, grade: 0 },
        { ...shot, grade: null },
        { ...shot, grade: null, excluded: "Pick" },
      ]),
    ).toEqual({ attempts: 3, scored: 1, missing: 1, excluded: 1, percent: 0 });
    expect(report([]).percent).toBeNull();
    expect(shotSchema.parse(shot).execution).toBe("Partial");
  });
  it("rejects dual-family/unknown input and scored exclusions", () => {
    expect(shotSchema.safeParse({ ...shot, hitType: "Peel" }).success).toBe(
      false,
    );
    expect(shotSchema.safeParse({ ...shot, type: "Draw, Peel" }).success).toBe(
      false,
    );
    expect(shotSchema.safeParse({ ...shot, excluded: "Pick" }).success).toBe(
      false,
    );
    expect(shotSchema.safeParse({ ...shot, grade: 6 }).success).toBe(false);
    expect(
      commandSchema.safeParse({ ...command(), expectedRevision: -1 }).success,
    ).toBe(false);
  });
  it("keeps corrections, rejects stale writes, and deduplicates retries", () => {
    const first = command();
    const original = append(emptyState(), first, "coach");
    expect(append(original, first, "coach")).toBe(original);
    expect(() =>
      append(original, { ...first, shot: { ...shot, grade: 0 } }, "coach"),
    ).toThrow();
    expect(() => append(original, command(), "coach")).toThrow();
    const revised = append(
      original,
      { ...command(0), expectedRevision: 1, shotId: first.shotId },
      "coach",
    );
    expect(revised.events[0].shot?.grade).toBe(5);
    expect(report(currentShots(revised.events)).percent).toBe(0);
    const removed = append(
      revised,
      { ...command(), expectedRevision: 2, shotId: first.shotId, shot: null },
      "coach",
    );
    expect(currentShots(removed.events)).toEqual([]);
    expect(removed.events).toHaveLength(3);
  });
  it("preserves substitutions and extra ends without duplicate position slots", () => {
    const first = append(emptyState(), command(), "coach");
    expect(() =>
      append(
        first,
        {
          ...command(),
          expectedRevision: 1,
          shot: { ...shot, playerId: "alternate" },
        },
        "coach",
      ),
    ).toThrow();
    const second = append(
      first,
      {
        ...command(0),
        expectedRevision: 1,
        shot: { ...shot, playerId: "alternate", end: 11, grade: 0 },
      },
      "coach",
    );
    const shots = currentShots(second.events);
    expect(report(shots).percent).toBe(50);
    expect(report(shots.filter((s) => s.playerId === "lead")).percent).toBe(
      100,
    );
    expect(
      report(shots.filter((s) => s.playerId === "alternate")).percent,
    ).toBe(0);
  });
});
