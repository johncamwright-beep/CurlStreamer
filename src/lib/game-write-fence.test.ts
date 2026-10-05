import { expect, it } from "vitest";
import { GameWriteFence } from "./game-write-fence";

it("rejects delayed reads before, during and after the acknowledged write", () => {
  const fence = new GameWriteFence();
  const oldRead = fence.read();
  fence.begin();
  expect(fence.accepts(oldRead)).toBe(false);
  expect(fence.read()).toBeUndefined();
  fence.finish();
  expect(fence.accepts(oldRead)).toBe(false);
  expect(fence.accepts(fence.read())).toBe(true);
});

it("keeps reads fenced until every pending write has finished", () => {
  const fence = new GameWriteFence();
  fence.begin();
  fence.begin();
  fence.finish();
  expect(fence.read()).toBeUndefined();
  fence.finish();
  expect(fence.accepts(fence.read())).toBe(true);
});
