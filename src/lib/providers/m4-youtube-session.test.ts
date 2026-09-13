import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./team-access", () => ({
  requireTeamBroadcastAccess: vi.fn().mockResolvedValue(undefined),
}));
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  game: vi.fn(),
  actor: vi.fn(),
  decrypt: vi.fn(),
  refresh: vi.fn(),
  configuration: vi.fn(),
  broadcast: vi.fn(),
  stream: vi.fn(),
  bind: vi.fn(),
  finish: vi.fn(),
  remove: vi.fn(),
  findBroadcast: vi.fn(),
  findStream: vi.fn(),
  transition: vi.fn(),
  obs: vi.fn(),
  channel: vi.fn(),
  verifyRetirement: vi.fn(),
  observe: vi.fn(),
}));
vi.mock("./supabase-store", () => ({ getGame: mocks.game }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/game-completion", () => ({
  completionActorParameters: mocks.actor,
}));
vi.mock("./youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("./youtube", () => ({
  refreshYouTubeAccessToken: mocks.refresh,
  youtubeConfigurationStatus: mocks.configuration,
  loadOwnedYouTubeChannel: mocks.channel,
}));
vi.mock("./m4-provider-retirement", () => ({
  verifyM4ProviderRetirement: mocks.verifyRetirement,
}));
vi.mock("./m4-provider-observation", () => ({
  observeM4YouTubeProvider: mocks.observe,
}));
vi.mock("./youtube-live", () => ({
  findOrCreateYouTubeBroadcast: mocks.broadcast,
  findOrCreateYouTubeStream: mocks.stream,
  bindYouTubeBroadcast: mocks.bind,
  finishYouTubeBroadcast: mocks.finish,
  deleteYouTubeStream: mocks.remove,
  findYouTubeBroadcast: mocks.findBroadcast,
  findYouTubeStream: mocks.findStream,
  transitionYouTubeBroadcast: mocks.transition,
}));
vi.mock("./obs-local", () => ({ ObsLocal: mocks.obs }));
import {
  prepareM4Session,
  readM4Session,
  stopM4Session,
  goLiveM4Session,
} from "./m4-youtube-session";
const gameId = "11111111-1111-4111-8111-111111111111";
const credential = { kind: "organizer" as const, token: "private-organizer" };
const watchUrl = "https://www.youtube.com/watch?v=abcdefghijk";
function session(overrides: Record<string, unknown> = {}) {
  return {
    gameId,
    organizationId: "22222222-2222-4222-8222-222222222222",
    sessionKey: "33333333-3333-4333-8333-333333333333",
    operationToken: "44444444-4444-4444-8444-444444444444",
    generation: 1,
    transport: "local-obs",
    action: "run",
    desiredState: "live",
    status: "preparing",
    title: "M4 rehearsal",
    visibility: "unlisted",
    encryptedCredentials: "encrypted-private",
    savedChannelId: "original-channel",
    channelId: "original-channel",
    connectionVersion: 1,
    youtubeBroadcastCreateState: "none",
    youtubeStreamCreateState: "none",
    ...overrides,
  };
}
function state(
  initial: Record<string, unknown>,
  fence?: (parameters: Record<string, unknown>) => boolean,
) {
  let current = { ...initial };
  mocks.rpc.mockImplementation(
    async (name: string, p: Record<string, unknown>) => {
      if (
        name === "claim_m4_broadcast_operation" ||
        name === "get_m4_broadcast_session"
      )
        return { data: current, error: null };
      if (name === "confirm_m4_provider_retirement") {
        current = { ...current, status: "stopped", desiredState: "stopped" };
        return { data: current, error: null };
      }
      if (name !== "record_m4_broadcast_operation")
        throw new Error("Unexpected RPC");
      if (fence?.(p)) {
        current = { ...current, status: "stopping", desiredState: "stopped" };
        return { data: null, error: null };
      }
      current = {
        ...current,
        status: p.p_status,
        lastErrorCode: p.p_error_code ?? undefined,
      };
      for (const [key, param] of Object.entries({
        youtubeBroadcastId: "p_youtube_broadcast_id",
        youtubeStreamId: "p_youtube_stream_id",
        watchUrl: "p_watch_url",
        youtubeBroadcastCreateState: "p_youtube_broadcast_create_state",
        youtubeStreamCreateState: "p_youtube_stream_create_state",
      }))
        if (p[param] != null) current[key] = p[param];
      return { data: current, error: null };
    },
  );
  return () => current;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected real network request")),
  );
  mocks.configuration.mockReturnValue(true);
  mocks.actor.mockResolvedValue({ p_actor_user_id: "user-id" });
  mocks.decrypt.mockReturnValue("private-refresh");
  mocks.refresh.mockResolvedValue("private-access");
  mocks.channel.mockResolvedValue({
    id: "original-channel",
    title: "Original",
  });
  mocks.verifyRetirement.mockResolvedValue(undefined);
  mocks.broadcast.mockResolvedValue({
    id: "broadcast-id",
    watchUrl,
    lifeCycleStatus: "ready",
  });
  mocks.stream.mockResolvedValue({
    id: "stream-id",
    rtmpUrl: "rtmp://ingest/private-stream-key",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("M4 provider orchestration", () => {
  it("retries preparation only after abandoned-session cleanup is confirmed", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ error: { code: "55000" } })
      .mockResolvedValueOnce({
        data: session({
          action: "none",
          status: "stopped",
          desiredState: "stopped",
        }),
      })
      .mockResolvedValueOnce({
        data: session({ action: "none", status: "prepared" }),
      });
    expect(await prepareM4Session(gameId, credential)).toMatchObject({
      status: "prepared",
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_m4_broadcast_operation",
      "claim_abandoned_m4_cleanup",
      "claim_m4_broadcast_operation",
    ]);
  });
  it("does not stop an active desktop when abandoned cleanup is refused", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ error: { code: "55000" } })
      .mockResolvedValueOnce({ error: { code: "55000" } });
    await expect(prepareM4Session(gameId, credential)).rejects.toMatchObject({
      code: "55000",
    });
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("prepares manual provider resources in durable order without starting OBS or transitioning live", async () => {
    state(session());
    const result = await prepareM4Session(gameId, credential);
    expect(result).toEqual({
      desiredState: "live",
      status: "prepared",
      watchUrl,
    });
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "unlisted",
        manualLifecycle: true,
      }),
      fetch,
      true,
    );
    expect(mocks.stream).toHaveBeenCalledWith(expect.any(Object), fetch, true);
    expect(mocks.bind).toHaveBeenCalledWith(
      "private-access",
      "broadcast-id",
      "stream-id",
    );
    expect(
      mocks.rpc.mock.calls
        .filter(([name]) => name === "record_m4_broadcast_operation")
        .map(([, p]) => p.p_provider_step),
    ).toEqual([
      "m4-broadcast-intent",
      "m4-broadcast-ready",
      "m4-stream-intent",
      "m4-stream-ready",
      "m4-prepared",
    ]);
    expect(mocks.obs).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const exposed = JSON.stringify({ result, writes: mocks.rpc.mock.calls });
    for (const secret of [
      "private-access",
      "private-refresh",
      "private-stream-key",
      "encrypted-private",
      "private-organizer",
    ])
      expect(exposed).not.toContain(secret);
  });
  it.each(["wait", "none"])(
    "does not perform provider calls when claim action is %s",
    async (action) => {
      state(session({ action, status: "prepared" }));
      await prepareM4Session(gameId, credential);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.broadcast).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("disables all resource creation when retrying unresolved intents", async () => {
    state(
      session({
        youtubeBroadcastCreateState: "uncertain",
        youtubeStreamCreateState: "intent",
      }),
    );
    await prepareM4Session(gameId, credential);
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.any(Object),
      fetch,
      false,
    );
    expect(mocks.stream).toHaveBeenCalledWith(expect.any(Object), fetch, false);
  });
  it.each(["m4-broadcast-intent", "m4-broadcast-ready", "m4-stream-ready"])(
    "stops after losing its fence at %s",
    async (step) => {
      state(session(), (p) => p.p_provider_step === step);
      const result = await prepareM4Session(gameId, credential);
      expect(result).toMatchObject({
        status: "stopping",
        desiredState: "stopped",
      });
      expect(mocks.bind).not.toHaveBeenCalled();
      if (step === "m4-broadcast-intent")
        expect(mocks.broadcast).not.toHaveBeenCalled();
      if (step !== "m4-stream-ready")
        expect(mocks.stream).not.toHaveBeenCalled();
      expect(
        mocks.rpc.mock.calls.some(([, p]) => p.p_status === "prepared"),
      ).toBe(false);
    },
  );
  it("redacts arbitrary provider exceptions and journals uncertain resource creation", async () => {
    const current = state(session());
    mocks.broadcast.mockRejectedValue(
      new Error("Bearer private-access rt...private-stream-key"),
    );
    const result = await prepareM4Session(gameId, credential);
    expect(result).toMatchObject({
      status: "failed",
      lastErrorCode: "m4_provider_unavailable",
    });
    expect(current().youtubeBroadcastCreateState).toBe("uncertain");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      "private-stream-key",
    );
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it("narrows persisted unknown errors and strips credential fields on read", async () => {
    state(
      session({
        lastErrorCode: "private-provider-error",
        watchUrl,
        status: "failed",
      }),
    );
    expect(await readM4Session(gameId, credential)).toEqual({
      status: "failed",
      desiredState: "live",
      watchUrl,
      lastErrorCode: "m4_provider_unavailable",
    });
  });
  it("does not bind or create a stream for a terminal discovered broadcast", async () => {
    state(session());
    mocks.broadcast.mockResolvedValue({
      id: "broadcast-id",
      watchUrl,
      lifeCycleStatus: "complete",
    });
    expect(await prepareM4Session(gameId, credential)).toMatchObject({
      status: "failed",
      lastErrorCode: "youtube_broadcast_terminal",
    });
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it.each(["intent", "uncertain", "ready"])(
    "does not claim stopped when %s broadcast discovery finds nothing",
    async (creation) => {
      state(
        session({
          desiredState: "stopped",
          status: "stopping",
          youtubeBroadcastCreateState: creation,
        }),
      );
      mocks.findBroadcast.mockResolvedValue(undefined);
      expect(await stopM4Session(gameId, credential)).toMatchObject({
        status: "failed",
        lastErrorCode: "broadcast_operation_uncertain",
      });
      expect(mocks.finish).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(
        mocks.rpc.mock.calls.some(([, p]) => p.p_status === "stopped"),
      ).toBe(false);
    },
  );
  it("keeps cleanup failed when discovery itself is incomplete", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeStreamCreateState: "uncertain",
      }),
    );
    mocks.findStream.mockRejectedValue(
      new Error("broadcast_discovery_incomplete"),
    );
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "failed",
      lastErrorCode: "broadcast_discovery_incomplete",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("recovers identifiers by discovery and confirms each cleanup step before stopped", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastCreateState: "uncertain",
        youtubeStreamCreateState: "uncertain",
      }),
    );
    mocks.findBroadcast.mockResolvedValue({ id: "recovered-broadcast" });
    mocks.findStream.mockResolvedValue({ id: "recovered-stream" });
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "stopped",
    });
    expect(mocks.finish).toHaveBeenCalledWith(
      "private-access",
      "recovered-broadcast",
    );
    expect(mocks.remove).toHaveBeenCalledWith(
      "private-access",
      "recovered-stream",
    );
    expect(
      mocks.rpc.mock.calls
        .filter(([name]) => name === "record_m4_broadcast_operation")
        .map(([, p]) => p.p_provider_step),
    ).toEqual(["m4-cleanup-intent", "m4-broadcast-finished"]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "confirm_m4_provider_retirement",
      expect.objectContaining({
        p_youtube_broadcast_id: "recovered-broadcast",
        p_youtube_stream_id: "recovered-stream",
        p_youtube_channel_id: "original-channel",
        p_connection_version: 1,
        p_encrypted_credentials: "encrypted-private",
      }),
    );
  });
  it("does not delete a stream after failing to confirm broadcast cleanup", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
      }),
    );
    mocks.finish.mockRejectedValue(new Error("failed private-stream-key"));
    mocks.verifyRetirement.mockRejectedValue(new Error("unconfirmed"));
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "failed",
      lastErrorCode: "m4_provider_unavailable",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("accepts a lost delete response only after independent retirement verification", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
      }),
    );
    mocks.remove.mockRejectedValue(new Error("response lost"));
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "stopped",
    });
    expect(mocks.verifyRetirement).toHaveBeenCalledWith("private-access", {
      broadcastId: "broadcast-id",
      streamId: "stream-id",
      channelId: "original-channel",
    });
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === "confirm_m4_provider_retirement",
      ),
    ).toHaveLength(1);
  });
  it("resolves a lost finish response before deleting and independently verifying the stream", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
      }),
    );
    mocks.finish.mockRejectedValue(new Error("response lost"));
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "stopped",
    });
    expect(mocks.verifyRetirement.mock.calls).toEqual([
      [
        "private-access",
        { broadcastId: "broadcast-id", channelId: "original-channel" },
      ],
      [
        "private-access",
        {
          broadcastId: "broadcast-id",
          streamId: "stream-id",
          channelId: "original-channel",
        },
      ],
    ]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("retires a partially prepared broadcast without inventing a stream", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamCreateState: "none",
      }),
    );
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "stopped",
    });
    expect(mocks.verifyRetirement).toHaveBeenCalledWith("private-access", {
      broadcastId: "broadcast-id",
      streamId: undefined,
      channelId: "original-channel",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "confirm_m4_provider_retirement",
      expect.objectContaining({
        p_youtube_broadcast_id: "broadcast-id",
        p_youtube_stream_id: null,
      }),
    );
  });
  it("keeps cleanup uncertain when final retirement persistence is fenced", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
      }),
    );
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name, parameters) =>
      name === "confirm_m4_provider_retirement"
        ? { data: null, error: { code: "55000" } }
        : original(name, parameters),
    );
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "failed",
    });
    expect(
      mocks.rpc.mock.calls.some(
        ([name, parameters]) =>
          name === "record_m4_broadcast_operation" &&
          parameters.p_status === "stopped",
      ),
    ).toBe(false);
  });
  it("does not retire uncertain provider state", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
      }),
    );
    mocks.verifyRetirement.mockRejectedValue(
      new Error("m4_retirement_unconfirmed"),
    );
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      status: "failed",
      lastErrorCode: "m4_retirement_unconfirmed",
    });
    expect(
      mocks.rpc.mock.calls.some(
        ([name]) => name === "confirm_m4_provider_retirement",
      ),
    ).toBe(false);
  });
  it("rejects credentials for another channel before touching provider resources", async () => {
    state(
      session({
        desiredState: "stopped",
        status: "stopping",
        youtubeBroadcastId: "broadcast-id",
        youtubeStreamId: "stream-id",
      }),
    );
    mocks.channel.mockResolvedValue({ id: "another-channel" });
    expect(await stopM4Session(gameId, credential)).toMatchObject({
      lastErrorCode: "youtube_reconnect_required",
    });
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects preparation outside disposable configuration before any claim", async () => {
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "");
    await expect(prepareM4Session(gameId, credential)).rejects.toThrow(
      "M4 preparation unavailable",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("M4 explicit automatic go-live", () => {
  const prepared = () =>
    session({
      status: "prepared",
      youtubeBroadcastId: "broadcast-id",
      youtubeStreamId: "stream-id",
      watchUrl,
    });
  it("verifies active video and rechecks authority before requesting live", async () => {
    state(prepared());
    mocks.observe.mockResolvedValue({
      streamStatus: "active",
      broadcastStatus: "ready",
      broadcastLive: false,
    });
    await expect(goLiveM4Session(gameId, credential)).resolves.toEqual({
      desiredState: "live",
      status: "prepared",
      watchUrl,
      phase: "starting",
    });
    expect(mocks.transition).toHaveBeenCalledWith(
      "private-access",
      "broadcast-id",
      "live",
    );
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === "get_m4_broadcast_session",
      ),
    ).toHaveLength(2);
  });
  it("does not transition inactive video or a stopped session", async () => {
    state(prepared());
    mocks.observe.mockResolvedValue({
      streamStatus: "inactive",
      broadcastStatus: "ready",
      broadcastLive: false,
    });
    await expect(goLiveM4Session(gameId, credential)).resolves.toMatchObject({
      phase: "waiting-video",
    });
    expect(mocks.transition).not.toHaveBeenCalled();
    state({ ...prepared(), desiredState: "stopped" });
    await expect(goLiveM4Session(gameId, credential)).rejects.toThrow();
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("fences a concurrent stop or replacement during provider verification", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: prepared() })
      .mockResolvedValueOnce({ data: { ...prepared(), generation: 2 } });
    mocks.observe.mockResolvedValue({
      streamStatus: "active",
      broadcastStatus: "ready",
      broadcastLive: false,
    });
    await expect(goLiveM4Session(gameId, credential)).rejects.toThrow(
      "m4_operation_fenced",
    );
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("accepts an already live broadcast without repeating the transition", async () => {
    state(prepared());
    mocks.observe.mockResolvedValue({
      streamStatus: "active",
      broadcastStatus: "live",
      broadcastLive: true,
    });
    await goLiveM4Session(gameId, credential);
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
