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
vi.mock("./youtube", () => ({ refreshYouTubeAccessToken: mocks.refresh }));
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
  vi.useRealTimers();
});
describe("M4 desktop output observation", () => {
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
    expect(mocks.observe).toHaveBeenCalledWith("access-secret", {
      channelId: "channel",
      streamId: "stream",
      broadcastId: "broadcast",
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      credential.bearer,
    );
  });
  it.each([
    { organization_id: sessionId },
    { youtube_channel_id: "other" },
    { youtube_connection_version: 4 },
    { broadcast_generation: 3 },
    { expires_at: "2026-09-08T14:01:00Z" },
    { lease_expires_at: "2026-09-08T10:01:00Z" },
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
  it("does not return an observation after revocation during provider work", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(
      observeM4DesktopOutput(game, credential, intentId),
    ).rejects.toMatchObject({ code: "42501" });
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
