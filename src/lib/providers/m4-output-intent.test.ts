import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { claimM4OutputIntent } from "./m4-output-intent";
const game = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const credential = { sessionId, generation: 1, bearer: "b".repeat(43) };
const row = {
  intent_id: intentId,
  session_id: sessionId,
  generation: 1,
  phase: "reserved",
  delivery_recorded: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("M4 output-intent reservation boundary", () => {
  it("sends only a bearer hash and returns no provider destination", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...row, stream_key: "private-key" }],
      error: null,
    });
    expect(await claimM4OutputIntent(game, credential, intentId)).toEqual({
      intentId,
      sessionId,
      generation: 1,
      phase: "reserved",
      deliveryRecorded: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_m4_output_intent", {
      p_game_id: game,
      p_session_id: sessionId,
      p_generation: 1,
      p_intent_id: intentId,
      p_bearer_hash: createHash("sha256")
        .update(credential.bearer)
        .digest("hex"),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      credential.bearer,
    );
  });
  it("does not clear a returned quarantine or treat it as new permission", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...row, phase: "quarantined", delivery_recorded: true }],
      error: null,
    });
    expect((await claimM4OutputIntent(game, credential, intentId)).phase).toBe(
      "quarantined",
    );
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each([
    { ...row, intent_id: game },
    { ...row, session_id: game },
    { ...row, generation: 2 },
    { ...row, phase: "reserved", delivery_recorded: true },
    { ...row, phase: "quarantined", delivery_recorded: false },
  ])("fails closed on inconsistent intent authority", async (value) => {
    mocks.rpc.mockResolvedValue({ data: [value], error: null });
    await expect(
      claimM4OutputIntent(game, credential, intentId),
    ).rejects.toThrow(/^m4_output_intent_unavailable$/);
  });
  it("preserves safe rejection class without raw SQL details", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "private-key" },
    });
    const error = await claimM4OutputIntent(game, credential, intentId).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({
      message: "m4_output_intent_unavailable",
      code: "55000",
    });
    expect(JSON.stringify(error)).not.toContain("private-key");
  });
  it("cannot reserve with disabled flag or invalid credentials", async () => {
    await expect(
      claimM4OutputIntent(game, { ...credential, bearer: "bad" }, intentId),
    ).rejects.toThrow();
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "");
    await expect(
      claimM4OutputIntent(game, credential, intentId),
    ).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
