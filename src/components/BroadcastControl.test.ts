import { describe, expect, it } from "vitest";
import { broadcastControlView } from "./BroadcastControl";

describe("BroadcastControl state model", () => {
  it("shows Start and live/error status", () => {
    expect(
      broadcastControlView({ desiredState: "stopped", status: "idle" }),
    ).toMatchObject({
      primaryAction: "start",
      primaryLabel: "Start Broadcast",
      statusMessage: "YouTube is idle.",
    });
    expect(
      broadcastControlView({ desiredState: "live", status: "idle" }),
    ).toMatchObject({
      primaryAction: "start",
      primaryLabel: "Start Broadcast",
    });
    expect(
      broadcastControlView({ desiredState: "live", status: "live" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Stop Broadcast",
      statusMessage: "Live on the saved team YouTube channel.",
    });
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "broadcast_provider_ended",
      }).statusMessage,
    ).toContain("Broadcast failed");
  });

  it("keeps Stop available during preparation and final Stop retry authoritative", () => {
    expect(
      broadcastControlView({ desiredState: "live", status: "preparing" }),
    ).toMatchObject({
      showStopPreparation: true,
      primaryLabel: "Preparing YouTube…",
    });
    expect(
      broadcastControlView({ desiredState: "stopped", status: "failed" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Retry Stop",
    });
    expect(
      broadcastControlView({ desiredState: "stopped", status: "stopped" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Broadcast stopped",
      stoppedForever: true,
    });
  });
});
