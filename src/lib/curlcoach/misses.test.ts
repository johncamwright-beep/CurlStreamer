import { expect, it } from "vitest";
import { isMiss } from "./misses";
import { sampleEvent, eventShots } from "./event";
it("distinguishes imperfect shots from makes and ungraded attempts", () => {
  const base = eventShots(sampleEvent("shorty-example"))[0];
  const shot = {
    ...base,
    excluded: null,
    execution: null,
    deficiency: null,
    grade: null,
  };
  expect(isMiss(shot)).toBe(false);
  expect(
    isMiss({ ...shot, grade: 5, execution: "Make", deficiency: "Make" }),
  ).toBe(false);
  expect(isMiss({ ...shot, grade: 0 })).toBe(true);
  expect(isMiss({ ...shot, execution: "Partial" })).toBe(true);
  expect(isMiss({ ...shot, deficiency: "Light" })).toBe(true);
  expect(isMiss({ ...shot, excluded: "Pick", execution: "Xmiss" })).toBe(false);
});
