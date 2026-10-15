import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  decrypt: vi.fn(),
  refresh: vi.fn(),
  observe: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("./youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("./youtube", async (original) => ({
  ...(await original<typeof import("./youtube")>()),
  refreshYouTubeAccessToken: mocks.refresh,
}));
vi.mock("./m4-provider-observation", async (original) => ({
  ...(await original<typeof import("./m4-provider-observation")>()),
  observeM4YouTubeProvider: mocks.observe,
}));
import { observeM4DesktopOutput } from "./m4-desktop-observation";

const game = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const credential = { sessionId, generation: 1, bearer: "b".repeat(43) };
const row = {
  intent_id: intentId,
  session_id: sessionId,
  generation: 1,
  organization_id: game,
  encrypted_credentials: "ciphertext",
  broadcast_generation: 2,
  youtube_broadcast_id: "broadcast",
  youtube_stream_id: "stream",
  youtube_channel_id: "channel",
  youtube_connection_version: 3,
  expires_at: "2026-09-08T14:00:00Z",
  lease_expires_at: "2026-09-08T10:00:30Z",
};
const observation = {
  streamStatus: "active",
  healthStatus: "good",
  broadcastStatus: "live",
  broadcastLive: true,
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
  vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
  vi.stubEnv("CURLCAST_M4_TARGET_HANDOFF", "1");
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
  mocks.decrypt.mockReturnValue("refresh-secret");
  mocks.refresh.mockResolvedValue("access-secret");
  mocks.observe.mockResolvedValue(observation);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function abortableResponse(
  init: RequestInit | undefined,
  value: unknown,
  delay?: number,
) {
  return new Promise<Response>((resolve, reject) => {
    const signal = init?.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    if (delay !== undefined)
      timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve(new Response(JSON.stringify(value), { status: 200 }));
      }, delay);
  });
}
const googleResources = {
  stream: {
    items: [
      {
        id: "stream",
        snippet: { channelId: "channel" },
        status: { streamStatus: "active" },
      },
    ],
  },
  broadcast: {
    items: [
      {
        id: "broadcast",
        snippet: { channelId: "channel" },
        status: { lifeCycleStatus: "live", privacyStatus: "unlisted" },
        contentDetails: {
          boundStreamId: "stream",
          enableAutoStart: false,
          enableAutoStop: false,
        },
      },
    ],
  },
};
describe("M4 desktop output observation", () => {
  it("returns valid health before the desktop deadline when optional viewer retrieval stalls", async () => {
    const provider = await vi.importActual<
      typeof import("./m4-provider-observation")
    >("./m4-provider-observation");
    const budgetRow = {
      ...row,
      encrypted_credentials: "optional-budget-ciphertext",
    };
    mocks.rpc.mockResolvedValue({ data: [budgetRow], error: null });
    mocks.observe.mockImplementation(provider.observeM4YouTubeProvider);
    mocks.refresh.mockImplementation(
      async (_secret, googleFetch: typeof fetch) => {
        await googleFetch("https://oauth2.googleapis.com/token");
        return "access-secret";
      },
    );
    const requests = vi.fn<typeof fetch>().mockImplementation((url, init) => {
      const path = String(url);
      if (path.includes("oauth2")) return abortableResponse(init, {}, 2000);
      if (path.includes("/channels?"))
        return abortableResponse(init, { items: [{ id: "channel" }] }, 0);
      if (path.includes("/liveStreams?"))
        return abortableResponse(init, googleResources.stream, 6000);
      if (path.includes("/liveBroadcasts?"))
        return abortableResponse(init, googleResources.broadcast, 6000);
      return abortableResponse(init, {});
    });
    vi.stubGlobal("fetch", requests);
    const began = Date.now();
    const result = observeM4DesktopOutput(game, credential, intentId);
    const settled = vi.fn();
    void result.then(settled, settled);
    await vi.advanceTimersByTimeAsync(8500);
    expect(
      requests.mock.calls.some(([url]) => String(url).includes("/videos?")),
    ).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toMatchObject({
      broadcastLive: true,
      streamStatus: "active",
      concurrentViewers: null,
    });
    expect(Date.now() - began).toBeLessThan(12000);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "assert_m4_output_delivery",
      "assert_m4_output_delivery",
      "record_m4_live_evidence",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails closed on stalled mandatory Google reads and sends no further reads after the shared budget", async () => {
    const provider = await vi.importActual<
      typeof import("./m4-provider-observation")
    >("./m4-provider-observation");
    mocks.rpc.mockResolvedValue({
      data: [{ ...row, encrypted_credentials: "mandatory-budget-ciphertext" }],
      error: null,
    });
    mocks.observe.mockImplementation(provider.observeM4YouTubeProvider);
    mocks.refresh.mockImplementation(
      async (_secret, googleFetch: typeof fetch) => {
        await googleFetch("https://oauth2.googleapis.com/token");
        return "access-secret";
      },
    );
    const requests = vi.fn<typeof fetch>().mockImplementation((url, init) => {
      const path = String(url);
      if (path.includes("oauth2")) return abortableResponse(init, {}, 2000);
      if (path.includes("/channels?"))
        return abortableResponse(init, { items: [{ id: "channel" }] }, 0);
      return abortableResponse(init, {});
    });
    vi.stubGlobal("fetch", requests);
    const result = observeM4DesktopOutput(game, credential, intentId).catch(
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(9000);
    expect(await result).toMatchObject({
      message: "m4_desktop_observation_unavailable",
    });
    expect(requests).toHaveBeenCalledTimes(4);
    expect(requests.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(
      true,
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const scopedFetch = mocks.refresh.mock.calls[0][1] as typeof fetch;
    expect(() =>
      scopedFetch("https://www.googleapis.com/youtube/v3/videos"),
    ).toThrow();
    expect(requests).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])(
    "preserves caller cancellation and clears the shared timer after provider failure=%s",
    async (failure) => {
      const requests = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}"));
      vi.stubGlobal("fetch", requests);
      mocks.observe.mockImplementation(
        async (_token, _expected, googleFetch: typeof fetch) => {
          const caller = new AbortController();
          const read = googleFetch(
            "https://www.googleapis.com/youtube/v3/liveStreams",
            { signal: caller.signal },
          );
          caller.abort();
          await read;
          expect(requests.mock.calls[0][1]?.signal?.aborted).toBe(true);
          if (failure) throw new Error("provider-canary");
          return observation;
        },
      );
      const result = observeM4DesktopOutput(game, credential, intentId);
      if (failure)
        await expect(result).rejects.toThrow(
          "m4_desktop_observation_unavailable",
        );
      else await expect(result).resolves.toMatchObject({ broadcastLive: true });
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("preserves only allowlisted provider categories through the desktop boundary", async () => {
    mocks.observe.mockRejectedValue(
      Object.assign(new Error("secret-canary"), {
        reason: "youtube_quota_exceeded",
      }),
    );
    await expect(
      observeM4DesktopOutput(game, credential, intentId),
    ).rejects.toMatchObject({
      message: "m4_desktop_observation_unavailable",
      reason: "youtube_quota_exceeded",
    });
    mocks.observe.mockRejectedValue(
      Object.assign(new Error("secret-canary"), { reason: "secret-canary" }),
    );
    const error = await observeM4DesktopOutput(
      game,
      credential,
      intentId,
    ).catch((error) => error);
    expect(error.reason).toBeUndefined();
    expect(error.message).not.toContain("secret-canary");
  });
  it("asserts a previously delivered binding before and after memory-only OAuth/provider reads", async () => {
    await expect(
      observeM4DesktopOutput(game, credential, intentId),
    ).resolves.toEqual({ intentId, sessionId, generation: 1, ...observation });
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual([
      "assert_m4_output_delivery",
      "assert_m4_output_delivery",
      "record_m4_live_evidence",
    ]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.decrypt.mock.invocationCallOrder[0],
    );
    expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1],
    );
    expect(mocks.observe).toHaveBeenCalledWith(
      "access-secret",
      {
        channelId: "channel",
        streamId: "stream",
        broadcastId: "broadcast",
        visibility: "unlisted",
      },
      expect.any(Function),
      true,
      {
        organizationId: row.organization_id,
        connectionVersion: row.youtube_connection_version,
        credentialDigest: createHash("sha256")
          .update(row.encrypted_credentials)
          .digest("hex"),
      },
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      credential.bearer,
    );
  });
  it.each([
    { organization_id: sessionId },
    { youtube_channel_id: "other" },
    { youtube_connection_version: 4 },
    { encrypted_credentials: "replacement-ciphertext" },
    { broadcast_generation: 3 },
    { youtube_visibility: "public" },
    { expires_at: "2026-09-08T14:01:00Z" },
    { lease_expires_at: "2026-09-08T10:00:20Z" },
  ])(
    "discards observation after concurrent binding change %o",
    async (change) => {
      mocks.rpc
        .mockResolvedValueOnce({ data: [row], error: null })
        .mockResolvedValueOnce({ data: [{ ...row, ...change }], error: null });
      await expect(
        observeM4DesktopOutput(game, credential, intentId),
      ).rejects.toThrow(/^m4_desktop_observation_unavailable$/);
    },
  );
  it("checks Public output against the visibility saved with its authorized delivery", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...row, youtube_visibility: "public" }],
      error: null,
    });
    await expect(
      observeM4DesktopOutput(game, credential, intentId),
    ).resolves.toEqual({ intentId, sessionId, generation: 1, ...observation });
    expect(mocks.observe).toHaveBeenCalledWith(
      "access-secret",
      {
        channelId: "channel",
        streamId: "stream",
        broadcastId: "broadcast",
        visibility: "public",
      },
      expect.any(Function),
      true,
      {
        organizationId: row.organization_id,
        connectionVersion: row.youtube_connection_version,
        credentialDigest: createHash("sha256")
          .update(row.encrypted_credentials)
          .digest("hex"),
      },
    );
  });
  it("does not return an observation after revocation during provider work", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(
      observeM4DesktopOutput(game, credential, intentId),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("preserves live evidence when a concurrent heartbeat extends the same desktop lease", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({
        data: [{ ...row, lease_expires_at: "2026-09-08T10:01:00Z" }],
        error: null,
      });
    await expect(
      observeM4DesktopOutput(game, credential, intentId),
    ).resolves.toEqual({ intentId, sessionId, generation: 1, ...observation });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "record_m4_live_evidence",
      expect.any(Object),
    );
  });
  it.each(["CURLCAST_M4_LOCAL_YOUTUBE", "CURLCAST_M4_TARGET_HANDOFF"])(
    "requires %s",
    async (name) => {
      vi.stubEnv(name, "");
      await expect(
        observeM4DesktopOutput(game, credential, intentId),
      ).rejects.toThrow();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});
