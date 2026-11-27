import { beforeEach, describe, expect, it, vi } from "vitest";

const gameId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const sessionKey = "33333333-3333-4333-8333-333333333333";
const operationToken = "44444444-4444-4444-8444-444444444444";
const credential = { kind: "account", userId: "verified-user" } as never;

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: vi.fn(),
  decrypt: vi.fn(),
  refresh: vi.fn(),
  findOrCreateBroadcast: vi.fn(),
  findOrCreateStream: vi.fn(),
  bind: vi.fn(),
  finishBroadcast: vi.fn(),
  deleteStream: vi.fn(),
  findBroadcast: vi.fn(),
  findStream: vi.fn(),
  streamStatus: vi.fn(),
  broadcastStatus: vi.fn(),
  transition: vi.fn(),
  findOrStartEgress: vi.fn(),
  findEgress: vi.fn(),
  stopEgress: vi.fn(),
  egressStatus: vi.fn(),
  stopM4: vi.fn(),
}));

vi.mock("@/lib/providers/m4-youtube-session", () => ({
  stopM4Session: mocks.stopM4,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/game-completion", () => ({
  completionActorParameters: mocks.actor,
}));
vi.mock("@/lib/providers/youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("@/lib/providers/youtube", () => ({
  refreshYouTubeAccessToken: mocks.refresh,
  youtubeConfigurationStatus: vi.fn(() => true),
}));
vi.mock("@/lib/providers/youtube-live", () => ({
  findOrCreateYouTubeBroadcast: mocks.findOrCreateBroadcast,
  findOrCreateYouTubeStream: mocks.findOrCreateStream,
  bindYouTubeBroadcast: mocks.bind,
  finishYouTubeBroadcast: mocks.finishBroadcast,
  deleteYouTubeStream: mocks.deleteStream,
  findYouTubeBroadcast: mocks.findBroadcast,
  findYouTubeStream: mocks.findStream,
  getYouTubeStreamStatus: mocks.streamStatus,
  getYouTubeBroadcastStatus: mocks.broadcastStatus,
  transitionYouTubeBroadcast: mocks.transition,
}));
vi.mock("@/lib/providers/livekit-egress", () => ({
  findOrStartLiveKitEgress: mocks.findOrStartEgress,
  findLiveKitEgress: mocks.findEgress,
  stopLiveKitEgress: mocks.stopEgress,
  getLiveKitEgressStatus: mocks.egressStatus,
}));

import {
  parseBroadcastSession,
  readBroadcastSession,
  startGameBroadcast,
  stopGameBroadcast,
} from "./broadcast-session";

function session(values: Record<string, unknown> = {}) {
  return {
    action: "run",
    gameId,
    organizationId,
    sessionKey,
    generation: 1,
    operationToken,
    desiredState: "live",
    status: "preparing",
    title: "Final",
    visibility: "unlisted",
    encryptedCredentials: "encrypted",
    channelId: "channel",
    youtubeBroadcastCreateState: "none",
    youtubeStreamCreateState: "none",
    livekitEgressCreateState: "none",
    ...values,
  };
}

function recordingRpc(initial: Record<string, unknown>) {
  let current = { ...initial };
  mocks.rpc.mockImplementation(
    async (name: string, parameters: Record<string, unknown>) => {
      if (name === "get_game_broadcast_transport")
        return { data: "livekit", error: null };
      if (name === "claim_game_broadcast_operation")
        return { data: current, error: null };
      if (name === "record_game_broadcast_operation") {
        current = {
          ...current,
          status: parameters.p_status,
          youtubeBroadcastId:
            parameters.p_youtube_broadcast_id ?? current.youtubeBroadcastId,
          youtubeStreamId:
            parameters.p_youtube_stream_id ?? current.youtubeStreamId,
          livekitEgressId:
            parameters.p_livekit_egress_id ?? current.livekitEgressId,
          watchUrl: parameters.p_watch_url ?? current.watchUrl,
          lastErrorCode: parameters.p_error_code ?? undefined,
          providerStep: parameters.p_provider_step ?? undefined,
          uncertainSince: parameters.p_uncertain
            ? "2026-09-05T14:12:33.123456+00:00"
            : current.uncertainSince,
          youtubeBroadcastCreateState:
            parameters.p_youtube_broadcast_create_state ??
            current.youtubeBroadcastCreateState,
          youtubeStreamCreateState:
            parameters.p_youtube_stream_create_state ??
            current.youtubeStreamCreateState,
          livekitEgressCreateState:
            parameters.p_livekit_egress_create_state ??
            current.livekitEgressCreateState,
        };
        return { data: current, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  );
}

describe("broadcast session orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actor.mockResolvedValue({
      p_actor_user_id: "verified-user",
      p_verified_organizer: false,
    });
    mocks.decrypt.mockReturnValue("refresh-token");
    mocks.refresh.mockResolvedValue("access-token");
    mocks.findOrCreateBroadcast.mockResolvedValue({
      id: "broadcast-id",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghi",
      lifeCycleStatus: "ready",
    });
    mocks.findOrCreateStream.mockResolvedValue({
      id: "stream-id",
      rtmpUrl: "rtmp://youtube.example/live/secret",
      streamStatus: "active",
    });
    mocks.findOrStartEgress.mockResolvedValue({ id: "egress-id", status: 1 });
    mocks.broadcastStatus.mockResolvedValue("live");
    mocks.stopEgress.mockResolvedValue(undefined);
    mocks.egressStatus.mockResolvedValue(1);
    mocks.finishBroadcast.mockResolvedValue(undefined);
    mocks.deleteStream.mockResolvedValue(undefined);
  });

  it("accepts ISO offsets for PostgreSQL timestamps but rejects arbitrary text", () => {
    expect(
      parseBroadcastSession({
        ...session(),
        uncertainSince: "2026-09-05T14:12:33.123456+00:00",
      }).uncertainSince,
    ).toBe("2026-09-05T14:12:33.123456+00:00");
    expect(() =>
      parseBroadcastSession({
        ...session(),
        uncertainSince: "sometime yesterday",
      }),
    ).toThrow();
  });

  it("retries a hard-crash create intent with discovery only", async () => {
    recordingRpc(
      session({
        status: "failed",
        youtubeBroadcastCreateState: "intent",
      }),
    );
    mocks.findOrCreateBroadcast.mockRejectedValue(
      new Error("broadcast_operation_uncertain"),
    );
    const result = await startGameBroadcast(gameId, credential);
    expect(mocks.findOrCreateBroadcast.mock.calls[0][2]).toBe(false);
    expect(result).toMatchObject({ status: "failed", desiredState: "live" });
    expect(mocks.findOrCreateStream).not.toHaveBeenCalled();
  });

  it("keeps Stop failed when an egress create intent cannot be discovered", async () => {
    recordingRpc(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
        youtubeBroadcastCreateState: "ready",
        youtubeStreamCreateState: "ready",
        livekitEgressCreateState: "intent",
      }),
    );
    mocks.findEgress.mockResolvedValue(undefined);
    const result = await stopGameBroadcast(gameId, credential);
    expect(result).toMatchObject({ status: "failed", desiredState: "stopped" });
    expect(mocks.finishBroadcast).toHaveBeenCalledWith(
      "access-token",
      "broadcast-id",
    );
  });

  it("persists failed compensation after a stale egress checkpoint", async () => {
    const start = session();
    const stop = session({
      generation: 2,
      operationToken: "55555555-5555-4555-8555-555555555555",
      desiredState: "stopped",
      status: "stopping",
      youtubeBroadcastId: "broadcast-id",
      youtubeStreamId: "stream-id",
      youtubeBroadcastCreateState: "ready",
      youtubeStreamCreateState: "ready",
      livekitEgressCreateState: "intent",
    });
    let claimCount = 0;
    let egressReadyCheckpoint = false;
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "get_game_broadcast_transport")
          return { data: "livekit", error: null };
        if (name === "claim_game_broadcast_operation")
          return { data: claimCount++ === 0 ? start : stop, error: null };
        if (name === "record_game_broadcast_operation") {
          if (
            parameters.p_livekit_egress_id === "egress-id" &&
            parameters.p_status === "preparing"
          ) {
            egressReadyCheckpoint = true;
            return { data: null, error: null };
          }
          return {
            data: {
              ...(claimCount > 1 ? stop : start),
              status: parameters.p_status,
              lastErrorCode: parameters.p_error_code ?? undefined,
            },
            error: null,
          };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
    );
    mocks.findEgress.mockResolvedValue({ egressId: "egress-id" });
    mocks.stopEgress.mockRejectedValue(new Error("livekit_stop_unconfirmed"));
    const result = await startGameBroadcast(gameId, credential);
    expect(egressReadyCheckpoint).toBe(true);
    expect(mocks.stopEgress).toHaveBeenCalledWith("egress-id");
    expect(result).toMatchObject({ status: "failed", desiredState: "stopped" });
  });

  it("still attempts LiveKit Stop when Google credentials are unavailable", async () => {
    recordingRpc(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        livekitEgressId: "egress-id",
        youtubeBroadcastCreateState: "ready",
        livekitEgressCreateState: "ready",
      }),
    );
    mocks.refresh.mockRejectedValue(new Error("youtube_reconnect_required"));
    const result = await stopGameBroadcast(gameId, credential);
    expect(mocks.stopEgress).toHaveBeenCalledWith("egress-id");
    expect(result).toMatchObject({ status: "failed", desiredState: "stopped" });
  });

  it("persists a discovered egress ID across partial Stop failure and retry", async () => {
    recordingRpc(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeBroadcastCreateState: "ready",
        livekitEgressCreateState: "intent",
      }),
    );
    mocks.findEgress.mockResolvedValue({ egressId: "discovered-egress" });
    mocks.refresh
      .mockRejectedValueOnce(new Error("youtube_reconnect_required"))
      .mockResolvedValue("access-token");

    expect(await stopGameBroadcast(gameId, credential)).toMatchObject({
      status: "failed",
      desiredState: "stopped",
    });
    expect(await stopGameBroadcast(gameId, credential)).toMatchObject({
      status: "stopped",
      desiredState: "stopped",
    });
    expect(mocks.findEgress).toHaveBeenCalledTimes(1);
    expect(mocks.stopEgress).toHaveBeenLastCalledWith("discovered-egress");
  });

  it("continues past the offset-timestamp intent checkpoint exactly once", async () => {
    recordingRpc(session());
    const result = await startGameBroadcast(gameId, credential);
    expect(mocks.findOrCreateBroadcast).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastStatus).toHaveBeenCalledWith(
      "access-token",
      "broadcast-id",
    );
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "live", desiredState: "live" });
  });

  it("does not call providers when the database rejects restart after Stop", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "stopped broadcast cannot restart" },
    });
    await expect(startGameBroadcast(gameId, credential)).rejects.toMatchObject({
      code: "55000",
    });
    expect(mocks.findOrCreateBroadcast).not.toHaveBeenCalled();
    expect(mocks.findOrStartEgress).not.toHaveBeenCalled();
  });

  it("reconciles a persisted live status from read-only provider evidence", async () => {
    const live = session({
      status: "live",
      youtubeBroadcastId: "broadcast-id",
      livekitEgressId: "egress-id",
    });
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "get_game_broadcast_session")
          return { data: live, error: null };
        if (name === "record_game_broadcast_operation")
          return {
            data: {
              ...live,
              status: parameters.p_status,
              lastErrorCode: parameters.p_error_code,
            },
            error: null,
          };
        throw new Error(`unexpected RPC ${name}`);
      },
    );
    mocks.broadcastStatus.mockResolvedValue("complete");
    mocks.egressStatus.mockResolvedValue(3);
    expect(await readBroadcastSession(gameId, credential)).toMatchObject({
      status: "failed",
      lastErrorCode: "broadcast_provider_ended",
    });
    expect(mocks.findOrStartEgress).not.toHaveBeenCalled();
  });

  it("dispatches local journal cleanup without consulting flags or invoking LiveKit", async () => {
    mocks.rpc.mockResolvedValue({ data: "local-obs", error: null });
    mocks.stopM4.mockResolvedValue({
      desiredState: "stopped",
      status: "stopped",
      streamKey: "must-not-leak",
    });
    expect(await stopGameBroadcast(gameId, credential)).toEqual({
      desiredState: "stopped",
      status: "stopped",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_game_broadcast_transport",
      {
        p_game_id: gameId,
        p_actor_user_id: "verified-user",
        p_verified_organizer: false,
      },
    );
    expect(mocks.stopM4).toHaveBeenCalledWith(gameId, credential);
    expect(mocks.findEgress).not.toHaveBeenCalled();
    expect(mocks.stopEgress).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("maps a local prepared wait result without claiming live or stopped", async () => {
    mocks.rpc.mockResolvedValue({ data: "local-obs", error: null });
    mocks.stopM4.mockResolvedValue({
      desiredState: "stopped",
      status: "prepared",
    });
    expect(await stopGameBroadcast(gameId, credential)).toEqual({
      desiredState: "stopped",
      status: "preparing",
    });
  });

  it.each(["42501", "55000", "08006"])(
    "never falls back after transport authorization/service failure %s",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code, message: "sensitive" },
      });
      await expect(stopGameBroadcast(gameId, credential)).rejects.toMatchObject(
        { code },
      );
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.stopM4).not.toHaveBeenCalled();
      expect(mocks.stopEgress).not.toHaveBeenCalled();
    },
  );

  it("does not query transport when actor validation fails", async () => {
    mocks.actor.mockRejectedValue(
      Object.assign(Error("denied"), { code: "42501" }),
    );
    await expect(stopGameBroadcast(gameId, credential)).rejects.toMatchObject({
      code: "42501",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.stopM4).not.toHaveBeenCalled();
  });

  it.each(["42883", "PGRST202"])(
    "retains legacy cleanup when transport RPC is absent (%s)",
    async (code) => {
      recordingRpc(
        session({
          desiredState: "stopped",
          status: "stopping",
          livekitEgressId: "legacy-egress",
          livekitEgressCreateState: "ready",
        }),
      );
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await stopGameBroadcast(gameId, credential)).toMatchObject({
        status: "stopped",
      });
      expect(mocks.stopEgress).toHaveBeenCalledWith("legacy-egress");
      expect(mocks.stopM4).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown journal transport rather than guessing a cleanup provider", async () => {
    mocks.rpc.mockResolvedValue({ data: "unknown", error: null });
    await expect(stopGameBroadcast(gameId, credential)).rejects.toThrow(
      "broadcast_transport_invalid",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.stopM4).not.toHaveBeenCalled();
    expect(mocks.stopEgress).not.toHaveBeenCalled();
  });
});
