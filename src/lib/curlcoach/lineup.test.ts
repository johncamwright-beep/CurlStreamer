import { describe, expect, it } from "vitest";
import { defaultLineup, resolvedLineup, rockNumber, rockSlot } from "./lineup";
import { nextTurn } from "./next-turn";
import { append, emptyState, roster, type Shot } from "./model";

describe("eight-rock game lineup", () => {
  it("keeps the four-player default and suggests 3/3/2 without assigning a reserve", () => {
    expect(defaultLineup(roster)).toEqual([
      "lead",
      "lead",
      "second",
      "second",
      "third",
      "third",
      "fourth",
      "fourth",
    ]);
    expect(
      defaultLineup(roster.filter((player) => player.id !== "fourth")),
    ).toEqual([
      "lead",
      "lead",
      "lead",
      "second",
      "second",
      "second",
      "third",
      "third",
    ]);
    expect(defaultLineup([])).toEqual([]);
    expect(resolvedLineup(roster, ["unknown"])).toEqual(defaultLineup(roster));
  });
  it("maps all eight rocks to distinct legacy shot slots", () => {
    for (let rock = 1; rock <= 8; rock++)
      expect(rockNumber(rockSlot(rock))).toBe(rock);
  });
  it("charts all eight rocks in a three-player lineup, then starts the next end", () => {
    const players = roster.filter((player) =>
      ["lead", "second", "third"].includes(player.id),
    );
    const lineup = defaultLineup(players);
    let state = { ...emptyState(), roster: [...players], lineup };
    let shot: Shot = {
      playerId: lineup[0],
      position: "Lead",
      stone: 1,
      end: 1,
      type: "Draw",
      turn: null,
      execution: null,
      grade: 5,
      deficiency: null,
      review: null,
      excluded: null,
      note: "",
    };
    const ids: string[] = [];
    for (let rock = 1; rock <= 8; rock++) {
      expect(rockNumber(shot)).toBe(rock);
      ids.push(shot.playerId);
      state = {
        ...append(
          state,
          {
            requestId: crypto.randomUUID(),
            expectedRevision: state.revision!,
            shotId: crypto.randomUUID(),
            shot,
          },
          "coach",
        ),
        roster: [...players],
        lineup,
      };
      shot = nextTurn(shot, [], players, lineup)!;
    }
    expect(ids).toEqual(lineup);
    expect(state.events).toHaveLength(8);
    expect(shot).toMatchObject({
      end: 2,
      position: "Lead",
      stone: 1,
      playerId: "lead",
    });
  });
});
