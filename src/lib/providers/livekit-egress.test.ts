import { afterEach, describe, expect, it, vi } from "vitest";
import { EgressStatus } from "livekit-server-sdk";
import {
  findOrStartLiveKitEgress,
  LIVEKIT_EGRESS_CLIENT_OPTIONS,
  stopLiveKitEgress,
} from "./livekit-egress";

describe("LiveKit Web Egress provider", () => {
  afterEach(() => {
    delete process.env.APP_BASE_URL;
  });

  it("uses an eight-second timeout and disables SDK failover retries", () => {
    expect(LIVEKIT_EGRESS_CLIENT_OPTIONS).toEqual({
      requestTimeout: 8,
      failover: false,
    });
  });

  it("uses the production program URL and 1080p stream output", async () => {
    process.env.APP_BASE_URL = "https://curlstreamer.example";
    const client = {
      listEgress: vi.fn().mockResolvedValue([]),
      startEgress: vi.fn().mockResolvedValue({
        egressId: "egress-id",
        status: EgressStatus.EGRESS_ACTIVE,
      }),
    };
    await findOrStartLiveKitEgress(
      {
        gameId: "11111111-1111-4111-8111-111111111111",
        sessionKey: "22222222-2222-4222-8222-222222222222",
        rtmpUrl: "rtmp://youtube.example/live/secret",
      },
      client as never,
    );
    const request = client.startEgress.mock.calls[0][0];
    expect(request.source.value.url).toBe(
      "https://curlstreamer.example/broadcast/11111111-1111-4111-8111-111111111111?broadcastSession=22222222-2222-4222-8222-222222222222",
    );
    expect(request.outputs[0].config.value.urls).toEqual([
      "rtmp://youtube.example/live/secret",
    ]);
  });

  it("reconciles a timeout retry from the marker in an active egress URL", async () => {
    process.env.APP_BASE_URL = "https://curlstreamer.example";
    const renderUrl =
      "https://curlstreamer.example/broadcast/game?broadcastSession=session";
    const client = {
      listEgress: vi.fn().mockResolvedValue([
        {
          egressId: "existing-egress",
          status: EgressStatus.EGRESS_ACTIVE,
          request: {
            case: "egress",
            value: { source: { case: "web", value: { url: renderUrl } } },
          },
        },
      ]),
      startEgress: vi.fn(),
    };
    const value = await findOrStartLiveKitEgress(
      { gameId: "game", sessionKey: "session", rtmpUrl: "rtmp://secret" },
      client as never,
    );
    expect(value.id).toBe("existing-egress");
    expect(client.startEgress).not.toHaveBeenCalled();
  });

  it("does not create Egress when a prior create intent is unresolved", async () => {
    process.env.APP_BASE_URL = "https://curlstreamer.example";
    const client = {
      listEgress: vi.fn().mockResolvedValue([]),
      startEgress: vi.fn(),
    };
    await expect(
      findOrStartLiveKitEgress(
        {
          gameId: "game",
          sessionKey: "unresolved",
          rtmpUrl: "rtmp://secret",
        },
        client as never,
        false,
      ),
    ).rejects.toThrow("broadcast_operation_uncertain");
    expect(client.startEgress).not.toHaveBeenCalled();
  });

  it("does not stop an already completed egress", async () => {
    const client = {
      listEgress: vi
        .fn()
        .mockResolvedValue([
          { egressId: "done", status: EgressStatus.EGRESS_COMPLETE },
        ]),
      stopEgress: vi.fn(),
    };
    await stopLiveKitEgress("done", client as never);
    expect(client.stopEgress).not.toHaveBeenCalled();
  });

  it("does not claim Stop until Egress reaches a terminal state", async () => {
    const client = {
      listEgress: vi
        .fn()
        .mockResolvedValue([
          { egressId: "active", status: EgressStatus.EGRESS_ACTIVE },
        ]),
      stopEgress: vi.fn().mockResolvedValue(undefined),
    };
    await expect(stopLiveKitEgress("active", client as never)).rejects.toThrow(
      "livekit_stop_unconfirmed",
    );
    expect(client.stopEgress).toHaveBeenCalledWith("active");
  });
});
