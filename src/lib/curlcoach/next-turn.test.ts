import { expect, it } from "vitest";
import { sampleEvent, gameShots } from "./event";
import { nextTurn } from "./next-turn";
const shot = {
  ...gameShots(sampleEvent("shorty-example").games[0])[0],
  note: "Old note",
};
it("advances stones, players and ends without carrying over shot evaluation", () => {
  expect(nextTurn(shot, [])!).toMatchObject({
    position: "Lead",
    stone: 2,
    end: 1,
    grade: null,
    note: "",
  });
  expect(nextTurn({ ...shot, stone: 2 }, [])!).toMatchObject({
    playerId: "second",
    position: "Second",
    stone: 1,
    end: 1,
  });
  expect(
    nextTurn(
      { ...shot, position: "Fourth", playerId: "fourth", stone: 2, end: 8 },
      [],
    )!,
  ).toMatchObject({ position: "Lead", stone: 1, end: 9 });
  expect(
    nextTurn({ ...shot, position: "Fourth", stone: 2, end: 20 }, []),
  ).toBeNull();
});
it("keeps substitutions in the throwing position", () => {
  expect(nextTurn({ ...shot, playerId: "alternate" }, [])!.playerId).toBe(
    "alternate",
  );
  expect(
    nextTurn({ ...shot, stone: 2 }, [
      { ...shot, position: "Second", playerId: "alternate" },
    ])!.playerId,
  ).toBe("alternate");
});
