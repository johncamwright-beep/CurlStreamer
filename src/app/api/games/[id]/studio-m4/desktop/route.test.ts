import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  approve: vi.fn(),
  exchange: vi.fn(),
  heartbeat: vi.fn(),
  stop: vi.fn(),
  verified: vi.fn(),
  token: vi.fn(),
}));
vi.mock("@/lib/providers/m4-desktop-authority", () => ({
  m4DesktopEnabled: mocks.enabled,
  approveM4DesktopPairing: mocks.approve,
  exchangeM4DesktopPairing: mocks.exchange,
  heartbeatM4Desktop: mocks.heartbeat,
  stopM4Desktop: mocks.stop,
}));
vi.mock("@/lib/game-completion", () => ({
  verifiedCompletionAccount: mocks.verified,
}));
vi.mock("@/lib/tokens", () => ({ readAccessToken: mocks.token }));
import { POST as approve } from "../desktop-pairing/route";
import { POST as exchange } from "./exchange/route";
import { POST as desktop } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id }) };
const session = {
  sessionId,
  generation: 2,
  expiresAt: "2026-09-08T12:00:00.000Z",
};
const lease = {
  ...session,
  leaseExpiresAt: "2026-09-08T10:00:30.000Z",
  desiredAction: "wait",
};
const account = { kind: "account", userId: id };
const bearer = "b".repeat(43),
  code = "c".repeat(43),
  verifier = "v".repeat(43),
  challenge = "a".repeat(64);
const heartbeat = { action: "heartbeat", sessionId, generation: 2 };
function req(body: unknown, headers: HeadersInit = {}) {
  return new Request(
    `https://127.0.0.1:3000/api/games/${id}/studio-m4/desktop`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://pilot.example");
  mocks.enabled.mockReturnValue(true);
  mocks.verified.mockResolvedValue({ ok: true, value: account });
  mocks.token.mockRejectedValue(Error("invalid"));
  mocks.approve.mockResolvedValue({ ...session, code });
  mocks.exchange.mockResolvedValue({ ...lease, bearer });
  mocks.heartbeat.mockResolvedValue(lease);
  mocks.stop.mockResolvedValue({ ...lease, desiredAction: "stop" });
});
afterEach(() => vi.unstubAllEnvs());
describe("M4 restricted desktop authority routes", () => {
  it("approves a challenge using a verified account behind a canonical-origin proxy", async () => {
    const result = await approve(
      req(
        { challenge },
        { origin: "https://pilot.example", "x-forwarded-host": "evil.example" },
      ),
      context,
    );
    expect(result.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(
      id,
      account,
      challenge,
    );
    expect(await result.json()).toEqual({ ...session, code });
  });
  it.each(["participant", "invitation"])(
    "does not allow %s bearer or M3 cookie to approve",
    async (purpose) => {
      mocks.verified.mockResolvedValue({ ok: false });
      mocks.token.mockResolvedValue({ purpose, gameId: id });
      expect(
        (
          await approve(
            req(
              { challenge },
              {
                authorization: "Bearer camera-token",
                cookie: "curlcast_m3_program=camera-cookie",
              },
            ),
            context,
          )
        ).status,
      ).toBe(403);
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );
  it("accepts same-game organizer but rejects a different game", async () => {
    mocks.verified.mockResolvedValue({ ok: false });
    mocks.token.mockResolvedValue({ purpose: "organizer", gameId: id });
    expect(
      (
        await approve(
          req({ challenge }, { authorization: "Bearer organizer-token" }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(
      id,
      { kind: "organizer", token: "organizer-token" },
      challenge,
    );
    mocks.token.mockResolvedValue({ purpose: "organizer", gameId: sessionId });
    expect(
      (
        await approve(
          req({ challenge }, { authorization: "Bearer wrong-game" }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.approve).toHaveBeenCalledTimes(1);
  });
  it.each<HeadersInit>([
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects cross-origin manager approval", async (headers) => {
    expect((await approve(req({ challenge }, headers), context)).status).toBe(
      403,
    );
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it.each<HeadersInit>([
    { origin: "https://pilot.example" },
    { origin: "null" },
    { "sec-fetch-site": "same-origin" },
  ])(
    "rejects browser exchange/heartbeat even with otherwise valid inputs",
    async (headers) => {
      expect(
        (await exchange(req({ code, verifier }, headers), context)).status,
      ).toBe(403);
      expect(
        (
          await desktop(
            req(heartbeat, {
              ...(headers as Record<string, string>),
              authorization: `Bearer ${bearer}`,
            }),
            context,
          )
        ).status,
      ).toBe(403);
      expect(mocks.exchange).not.toHaveBeenCalled();
      expect(mocks.heartbeat).not.toHaveBeenCalled();
    },
  );
  it("requires the code/verifier pair and returns restricted bearer only on exchange", async () => {
    const result = await exchange(
      req({ code, verifier }, { cookie: "ignored" }),
      context,
    );
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith(id, code, verifier);
    expect(await result.json()).toEqual({
      ...session,
      leaseExpiresAt: lease.leaseExpiresAt,
      bearer,
    });
    expect(mocks.verified).not.toHaveBeenCalled();
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("passes exact bearer/session/generation authority and strips unknown provider fields", async () => {
    mocks.heartbeat.mockResolvedValue({
      ...lease,
      bearer,
      verifier,
      streamKey: "secret",
    });
    const result = await desktop(
      req(heartbeat, { authorization: `Bearer ${bearer}` }),
      context,
    );
    expect(mocks.heartbeat).toHaveBeenCalledExactlyOnceWith(id, {
      sessionId,
      generation: 2,
      bearer,
    });
    expect(await result.json()).toEqual(lease);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("vary")).toBe("Cookie, Authorization");
  });
  it.each([
    undefined,
    "Bearer short",
    `Basic ${bearer}`,
    `Bearer ${bearer} extra`,
  ])(
    "does not substitute account cookies for missing or invalid bearer",
    async (authorization) => {
      expect(
        (
          await desktop(
            req(heartbeat, {
              cookie: "account=valid",
              ...(authorization ? { authorization } : {}),
            }),
            context,
          )
        ).status,
      ).toBe(403);
      expect(mocks.verified).not.toHaveBeenCalled();
      expect(mocks.heartbeat).not.toHaveBeenCalled();
    },
  );
  it("keeps authorized stop available after feature disable", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await approve(req({ challenge }), context)).status).toBe(503);
    expect((await exchange(req({ code, verifier }), context)).status).toBe(503);
    expect(
      (
        await desktop(
          req(heartbeat, { authorization: `Bearer ${bearer}` }),
          context,
        )
      ).status,
    ).toBe(503);
    const result = await desktop(
      req(
        { ...heartbeat, action: "stop" },
        { authorization: `Bearer ${bearer}` },
      ),
      context,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ...lease, desiredAction: "stop" });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it.each([
    [approve, { challenge: "A".repeat(64) }],
    [approve, { challenge, verifier }],
    [exchange, { code }],
    [exchange, { code, verifier, bearer }],
    [desktop, { ...heartbeat, generation: 0 }],
    [desktop, { ...heartbeat, action: "start" }],
    [desktop, { ...heartbeat, sessionId: "bad" }],
    [desktop, { ...heartbeat, bearer }],
  ] as const)(
    "rejects invalid or surplus authority input",
    async (handler, body) => {
      expect((await handler(req(body), context)).status).toBe(400);
      expect(mocks.approve).not.toHaveBeenCalled();
      expect(mocks.exchange).not.toHaveBeenCalled();
      expect(mocks.heartbeat).not.toHaveBeenCalled();
    },
  );
  it.each(["42501", "55000", "unexpected"])(
    "maps provider errors without leaking data: %s",
    async (errorCode) => {
      mocks.exchange.mockRejectedValue(
        Object.assign(Error(`private ${bearer}`), { code: errorCode }),
      );
      const result = await exchange(req({ code, verifier }), context);
      expect(result.status).toBe(
        errorCode === "42501" ? 403 : errorCode === "55000" ? 409 : 503,
      );
      expect(await result.json()).toEqual({
        error: "Desktop authority is unavailable.",
        code: "m4_desktop_unavailable",
      });
    },
  );
  it("rejects invalid provider status instead of serializing arbitrary error text", async () => {
    mocks.heartbeat.mockResolvedValue({
      ...lease,
      desiredAction: `secret ${bearer}`,
    });
    const result = await desktop(
      req(heartbeat, { authorization: `Bearer ${bearer}` }),
      context,
    );
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(bearer);
  });
});
