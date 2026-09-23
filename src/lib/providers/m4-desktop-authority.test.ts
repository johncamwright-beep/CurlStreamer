import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/game-completion", () => ({
  completionActorParameters: mocks.actor,
}));
import {
  approveM4DesktopPairing,
  exchangeM4DesktopPairing,
  heartbeatM4Desktop,
  stopM4Desktop,
} from "./m4-desktop-authority";
const game = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const code = "c".repeat(43),
  verifier = "v".repeat(43),
  bearer = "b".repeat(43);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const row = {
  session_id: sessionId,
  generation: 1,
  expires_at: "2026-09-08T10:00:00+00:00",
  lease_expires_at: "2026-09-08T06:00:30+00:00",
  desired_action: "wait",
};
const credential = { sessionId, generation: 1, bearer };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
  mocks.actor.mockResolvedValue({
    p_actor_user_id: null,
    p_verified_organizer: true,
  });
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("M4 desktop authority server boundary", () => {
  it.each(["42501", "55000"])(
    "preserves only safe SQL classification %s",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code, message: "private-key", details: "private-vault" },
      });
      const error = await heartbeatM4Desktop(game, credential).catch(
        (value: unknown) => value,
      );
      expect(error).toMatchObject({ message: "m4_desktop_unavailable", code });
      expect(JSON.stringify(error)).not.toContain("private");
    },
  );
  it("authorizes manager before approving and sends only pairing hashes to SQL", async () => {
    const result = await approveM4DesktopPairing(
      game,
      { kind: "organizer", token: "organizer-secret" },
      digest(verifier),
    );
    expect(result.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.rpc).toHaveBeenCalledWith("approve_m4_desktop_pairing", {
      p_game_id: game,
      p_actor_user_id: null,
      p_verified_organizer: true,
      p_code_hash: digest(result.code),
      p_challenge_hash: digest(verifier),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      "organizer-secret",
    );
    expect(result).not.toHaveProperty("bearer");
  });
  it("cannot approve when manager validation fails", async () => {
    mocks.actor.mockRejectedValue(new Error("organizer-secret"));
    await expect(
      approveM4DesktopPairing(
        game,
        { kind: "organizer", token: "organizer-secret" },
        digest(verifier),
      ),
    ).rejects.toThrow("m4_desktop_unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("exchanges hashes only and returns a new bearer only after committed RPC", async () => {
    const result = await exchangeM4DesktopPairing(game, code, verifier);
    expect(result.bearer).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.rpc).toHaveBeenCalledWith("exchange_m4_desktop_pairing", {
      p_game_id: game,
      p_code_hash: digest(code),
      p_challenge_hash: digest(verifier),
      p_bearer_hash: digest(result.bearer),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(result.bearer);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(verifier);
  });
  it("fails closed without returning a bearer when exchange outcome is uncertain", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private-key", code: "XX000" },
    });
    await expect(
      exchangeM4DesktopPairing(game, code, verifier),
    ).rejects.toThrow(/^m4_desktop_unavailable$/);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("strips extra database credentials from heartbeat responses", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...row,
          bearer: "private-key",
          encrypted_credentials: "private-vault",
        },
      ],
      error: null,
    });
    const result = await heartbeatM4Desktop(game, credential);
    expect(result).toEqual({
      sessionId,
      generation: 1,
      expiresAt: row.expires_at,
      leaseExpiresAt: row.lease_expires_at,
      desiredAction: "wait",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("heartbeat_m4_desktop", {
      p_game_id: game,
      p_session_id: sessionId,
      p_generation: 1,
      p_bearer_hash: digest(bearer),
    });
  });
  it("keeps authenticated stop cleanup available when feature flag is disabled", async () => {
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "");
    await expect(heartbeatM4Desktop(game, credential)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: [{ ...row, desired_action: "stop" }],
      error: null,
    });
    expect((await stopM4Desktop(game, credential)).desiredAction).toBe("stop");
  });
  it.each([
    { ...row, session_id: game },
    { ...row, generation: 2 },
    { ...row, desired_action: "start" },
  ])("rejects inconsistent or escalated authority responses", async (value) => {
    mocks.rpc.mockResolvedValue({ data: [value], error: null });
    await expect(heartbeatM4Desktop(game, credential)).rejects.toThrow(
      /^m4_desktop_unavailable$/,
    );
  });
  it("rejects a stop response that still grants wait authority", async () => {
    await expect(stopM4Desktop(game, credential)).rejects.toThrow();
  });
  it("validates identifiers and secret shapes before calling SQL", async () => {
    await expect(
      exchangeM4DesktopPairing(game, code, "secret"),
    ).rejects.toThrow();
    await expect(heartbeatM4Desktop("not-id", credential)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
