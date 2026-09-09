import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  decrypt: vi.fn(),
  refresh: vi.fn(),
  target: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("./youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: mocks.decrypt,
}));
vi.mock("./youtube", () => ({ refreshYouTubeAccessToken: mocks.refresh }));
vi.mock("./youtube-ingest", () => ({ getYouTubeIngestTarget: mocks.target }));
import { deliverM4Target } from "./m4-target-delivery";
const game = "11111111-1111-4111-8111-111111111111",
  sessionId = "22222222-2222-4222-8222-222222222222",
  intentId = "33333333-3333-4333-8333-333333333333";
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
const target = {
  serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
  streamKey: "secret-key",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
  vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
  vi.stubEnv("CURLCAST_M4_TARGET_HANDOFF", "1");
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
  mocks.decrypt.mockReturnValue("refresh-secret");
  mocks.refresh.mockResolvedValue("access-secret");
  mocks.target.mockResolvedValue(target);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("once-only M4 credential delivery", () => {
  it("rejects a target key exceeding the native admission limit", async () => {
    mocks.target.mockResolvedValue({ ...target, streamKey: "x".repeat(256) });
    await expect(deliverM4Target(game, credential, intentId)).rejects.toThrow(
      /^m4_target_delivery_unavailable$/,
    );
    expect(mocks.target).toHaveBeenCalledOnce();
  });
  it("commits consume before credential lookup and rechecks authority after provider fetch", async () => {
    const result = await deliverM4Target(game, credential, intentId);
    expect(result).toEqual({
      intentId,
      sessionId,
      generation: 1,
      expiresAt: row.expires_at,
      leaseExpiresAt: row.lease_expires_at,
      target,
    });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual([
      "consume_m4_output_delivery",
      "assert_m4_output_delivery",
    ]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.decrypt.mock.invocationCallOrder[0],
    );
    expect(mocks.target.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1],
    );

    expect(mocks.decrypt).toHaveBeenCalledWith("ciphertext", game);
    expect(mocks.target).toHaveBeenCalledWith("access-secret", "stream");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      credential.bearer,
    );
  });
  it("rejects a consumed replay before reading OAuth or target", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "private-key" },
    });
    await expect(
      deliverM4Target(game, credential, intentId),
    ).rejects.toMatchObject({
      message: "m4_target_delivery_unavailable",
      code: "55000",
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it.each(["refresh", "target"] as const)(
    "does not retry or unquarantine after %s failure",
    async (stage) => {
      mocks[stage].mockRejectedValue(new Error("secret-key"));
      await expect(deliverM4Target(game, credential, intentId)).rejects.toThrow(
        /^m4_target_delivery_unavailable$/,
      );
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks[stage]).toHaveBeenCalledTimes(1);
    },
  );
  it("withholds target when stop occurs during provider fetch", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(
      deliverM4Target(game, credential, intentId),
    ).rejects.toMatchObject({ code: "42501" });
    expect(mocks.target).toHaveBeenCalledOnce();
  });
  it("withholds target after elapsed lease even if database response is stale", async () => {
    mocks.target.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-09-08T10:00:31Z"));
      return target;
    });
    await expect(deliverM4Target(game, credential, intentId)).rejects.toThrow(
      /^m4_target_delivery_unavailable$/,
    );
  });
  it.each([
    { session_id: game },
    { intent_id: game },
    { generation: 2 },
    { youtube_stream_id: "other" },
    { youtube_connection_version: 4 },
    { organization_id: sessionId },
    { encrypted_credentials: "changed-ciphertext" },
  ])("withholds target after changed binding %o", async (change) => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: [{ ...row, ...change }], error: null });
    await expect(deliverM4Target(game, credential, intentId)).rejects.toThrow(
      /^m4_target_delivery_unavailable$/,
    );
  });
  it.each(["CURLCAST_M4_LOCAL_YOUTUBE", "CURLCAST_M4_TARGET_HANDOFF"])(
    "requires %s flag",
    async (flag) => {
      vi.stubEnv(flag, "");
      await expect(
        deliverM4Target(game, credential, intentId),
      ).rejects.toThrow();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects wrong initial session binding before decrypting", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...row, session_id: game }],
      error: null,
    });
    await expect(deliverM4Target(game, credential, intentId)).rejects.toThrow(
      /^m4_target_delivery_unavailable$/,
    );
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("rejects nonprimary target even if an upstream implementation regresses", async () => {
    mocks.target.mockResolvedValue({
      ...target,
      serverUrl: "rtmp://other/live",
    });
    await expect(deliverM4Target(game, credential, intentId)).rejects.toThrow(
      /^m4_target_delivery_unavailable$/,
    );
  });
});
