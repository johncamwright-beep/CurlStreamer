import { describe, expect, it } from "vitest";
import { shouldApplyCameraZoomCommand } from "./camera-zoom-command";

describe("remote hardware zoom commands", () => {
  it("only accepts a fresh command issued for the current camera capture", () => {
    expect(
      shouldApplyCameraZoomCommand(
        { id: "new", value: 2, requestedAt: 105 },
        100,
        120,
      ),
    ).toBe(true);
    expect(
      shouldApplyCameraZoomCommand(
        { id: "old", value: 2, requestedAt: 99 },
        100,
        120,
      ),
    ).toBe(false);
    expect(
      shouldApplyCameraZoomCommand(
        { id: "stale", value: 2, requestedAt: 1 },
        0,
        30_002,
      ),
    ).toBe(false);
  });
});
