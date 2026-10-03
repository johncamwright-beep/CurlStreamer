import { describe, expect, it } from "vitest";
import { cameraIsShown, toggleCameraLayout } from "./camera-layout";
import { actionSchema } from "./schema";

describe("independent broadcast camera visibility", () => {
  it.each([
    ["split", "home", "away"],
    ["split", "away", "home"],
    ["home", "home", "none"],
    ["home", "away", "split"],
    ["away", "home", "split"],
    ["away", "away", "none"],
    ["none", "home", "home"],
    ["none", "away", "away"],
  ] as const)("toggles %s / %s to %s", (layout, camera, next) => {
    expect(toggleCameraLayout(layout, camera)).toBe(next);
    expect(cameraIsShown(next, camera)).toBe(!cameraIsShown(layout, camera));
    expect(
      actionSchema.safeParse({ type: "layout", layout: next }).success,
    ).toBe(true);
  });
});
