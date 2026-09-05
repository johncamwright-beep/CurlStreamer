import { describe, expect, it } from "vitest";
import { broadcastControlView } from "./BroadcastControl";

describe("BroadcastControl state model", () => {
  it("shows one context-appropriate action for idle and live states", () => {
    expect(
      broadcastControlView({ desiredState: "stopped", status: "idle" }),
    ).toMatchObject({
      primaryAction: "start",
      primaryLabel: "Start broadcast",
      statusLabel: "Not started",
    });
    expect(
      broadcastControlView({ desiredState: "live", status: "live" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "End broadcast",
      statusLabel: "Live",
    });
  });

  it("gives eligibility, access, quota, and generic failures distinct guidance", () => {
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "youtube_live_streaming_not_enabled",
      }),
    ).toMatchObject({
      statusMessage: expect.stringContaining("up to 24 hours"),
      supportLink: "eligibility",
    });
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "youtube_scope_missing",
      }),
    ).toMatchObject({
      statusMessage: expect.stringContaining("required access"),
      supportLink: "settings",
    });
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "youtube_quota_exceeded",
      }).statusMessage,
    ).toContain("capacity");
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "youtube_provider_rejected",
      }).statusMessage,
    ).not.toContain("Reconnect");
  });

  it("keeps final Stop authoritative without duplicate actions", () => {
    expect(
      broadcastControlView({ desiredState: "live", status: "preparing" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Cancel broadcast setup",
    });
    expect(
      broadcastControlView({ desiredState: "stopped", status: "failed" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Retry stop",
    });
    expect(
      broadcastControlView({ desiredState: "stopped", status: "stopped" }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Broadcast ended",
      stoppedForever: true,
    });
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "broadcast_operation_uncertain",
      }),
    ).toMatchObject({
      primaryAction: "start",
      primaryLabel: "Retry broadcast",
      showEndAction: true,
    });
    expect(
      broadcastControlView({
        desiredState: "live",
        status: "failed",
        lastErrorCode: "broadcast_provider_ended",
      }),
    ).toMatchObject({
      primaryAction: "stop",
      primaryLabel: "Finish broadcast",
    });
  });

  it("downgrades a failed live refresh without losing safe actions", () => {
    expect(
      broadcastControlView(
        {
          desiredState: "live",
          status: "live",
          watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        },
        true,
      ),
    ).toMatchObject({
      live: false,
      statusLabel: "Status unavailable",
      statusMessage: expect.stringContaining("Last confirmed live"),
      primaryAction: "refresh",
      primaryLabel: "Retry status",
      showEndAction: true,
    });
    expect(
      broadcastControlView({ desiredState: "stopped", status: "idle" }, true),
    ).toMatchObject({ primaryAction: "refresh", showEndAction: false });
    expect(
      broadcastControlView(
        { desiredState: "stopped", status: "idle" },
        true,
        true,
      ),
    ).toMatchObject({ primaryAction: "refresh", showEndAction: true });
  });
});
