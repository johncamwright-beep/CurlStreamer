import { describe, expect, it } from "vitest";
import {
  append,
  emptyState,
  setLineup,
  stateSchema,
  type LineupCommand,
} from "./model";
const command: LineupCommand = {
  action: "set-lineup",
  requestId: "10000000-0000-4000-8000-000000000001",
  expectedRevision: 0,
  lineup: [
    "lead",
    "lead",
    "lead",
    "second",
    "second",
    "second",
    "third",
    "third",
  ],
};
describe("eight-rock lineup state", () => {
  it("accepts legacy state and three-player 3/3/2 lineups", () => {
    expect(stateSchema.parse(emptyState()).lineup).toBeUndefined();
    const next = setLineup(emptyState(), command, "coach");
    expect(next.lineup).toEqual(command.lineup);
    expect(next.revision).toBe(1);
    expect(next.events).toEqual([]);
    expect(next.lineupEvents).toHaveLength(1);
  });
  it("rejects unknown players, wrong length, closed sessions, and stale revisions", () => {
    expect(() =>
      setLineup(
        emptyState(),
        { ...command, lineup: [...command.lineup.slice(0, 7), "outsider"] },
        "coach",
      ),
    ).toThrow("not in this coaching roster");
    expect(() =>
      setLineup(
        emptyState(),
        { ...command, lineup: command.lineup.slice(1) },
        "coach",
      ),
    ).toThrow();
    expect(() =>
      setLineup({ ...emptyState(), status: "closed" }, command, "coach"),
    ).toThrow("finished");
    expect(() =>
      setLineup({ ...emptyState(), revision: 2 }, command, "coach"),
    ).toThrow("Report changed");
  });
  it("keeps exact retries idempotent, rejects changed retries, and preserves recorded shot player IDs", () => {
    const first = setLineup(emptyState(), command, "coach");
    const recorded = append(
      first,
      {
        requestId: "10000000-0000-4000-8000-000000000002",
        expectedRevision: 1,
        shotId: "10000000-0000-4000-8000-000000000003",
        shot: {
          playerId: "lead",
          position: "Lead",
          stone: 1,
          end: 1,
          type: null,
          turn: null,
          execution: null,
          grade: null,
          deficiency: null,
          review: null,
          excluded: null,
          note: "",
        },
      },
      "coach",
    );
    expect(setLineup(recorded, command, "coach")).toBe(recorded);
    expect(() =>
      setLineup(
        recorded,
        { ...command, lineup: Array(8).fill("third") },
        "coach",
      ),
    ).toThrow("already used");
    const updated = setLineup(
      recorded,
      {
        ...command,
        requestId: "10000000-0000-4000-8000-000000000004",
        expectedRevision: 2,
        lineup: Array(8).fill("third"),
      },
      "coach",
    );
    expect(updated.events).toEqual(recorded.events);
    expect(updated.events[0].shot?.playerId).toBe("lead");
  });
});
