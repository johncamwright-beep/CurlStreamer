import { describe, expect, it } from "vitest";
import { nextConnectionState } from "./livekit-state";

describe("camera connection state", () => {
  it("moves through connecting, live, and disconnected for retry", () => {
    expect(nextConnectionState("idle", "connect")).toBe("connecting");
    expect(nextConnectionState("connecting", "published")).toBe("live");
    expect(nextConnectionState("live", "disconnect")).toBe("disconnected");
    expect(nextConnectionState("disconnected", "connect")).toBe("connecting");
  });
  it("shows camera permission denial distinctly", () => {
    expect(nextConnectionState("connecting", "permission-denied")).toBe(
      "permission-denied",
    );
  });
});
