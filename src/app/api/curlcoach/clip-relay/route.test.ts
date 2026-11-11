import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coach: vi.fn(),
  token: vi.fn(),
  account: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: mocks.coach,
}));
vi.mock("@/lib/tokens", () => ({ readAccessToken: mocks.token }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.account },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { POST } from "./route";

const gameId = "66666666-6666-4666-8666-6666666666ab";
const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const origin = "https://studio.example";
const relayUrl = "wss://relay.example";
const issuer = "test-livekit-key";
const secret = "server-only-livekit-test-key-long";
const path = "http://127.0.0.1:3000/api/curlcoach/clip-relay";

function request(
  body: unknown,
  headers: Record<string, string> = {},
  withOrigin = true,
) {
  return new Request(path, {
    method: "POST",
    headers: { ...(withOrigin ? { origin } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

async function readGrant(response: Response, role: "coach" | "studio") {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  const body = await response.json();
  expect(body).toEqual({ url: relayUrl, token: expect.any(String) });
  const { payload } = await jwtVerify(
    body.token,
    new TextEncoder().encode(secret),
    { issuer, algorithms: ["HS256"] },
  );
  expect(payload.video).toEqual({
    room: `coach-clip-${gameId}`,
    roomJoin: true,
    canPublishData: true,
    canPublish: false,
    canSubscribe: false,
    canUpdateOwnMetadata: false,
  });
  expect(payload.exp! - payload.iat!).toBe(role === "coach" ? 120 : 300);
  expect(JSON.parse(payload.metadata as string)).toEqual({
    role,
    gameId,
    expiresAt: payload.exp! * 1000,
  });
  return payload;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_BASE_URL", origin);
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_LIVEKIT_URL", relayUrl);
  vi.stubEnv("LIVEKIT_API_KEY", issuer);
  vi.stubEnv("LIVEKIT_API_SECRET", secret);
  mocks.coach.mockResolvedValue(null);
  mocks.account.mockResolvedValue({ data: { user: null }, error: null });
  mocks.token.mockRejectedValue(new Error("Invalid organizer proof"));
  mocks.rpc.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("Shot Tracker clip relay", () => {
  it("issues a fresh coach identity scoped to the verified team and canonical game", async () => {
    mocks.coach.mockResolvedValue({ userId, organizationId });
    const coach = { gameId: gameId.toUpperCase(), role: "coach" };
    const first = await readGrant(await POST(request(coach)), "coach");
    const second = await readGrant(await POST(request(coach)), "coach");
    expect(first.sub).toMatch(/^coach-[\da-f-]{36}$/);
    expect(second.sub).not.toBe(first.sub);
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
    for (const call of mocks.rpc.mock.calls)
      expect(call).toEqual([
        "authorize_coach_clip_relay",
        {
          p_game_id: gameId,
          p_role: "coach",
          p_actor_user_id: userId,
          p_verified_organizer: false,
          p_organization_id: organizationId,
        },
      ]);
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("uses Studio account authority without requiring a personal coach grant", async () => {
    mocks.account.mockResolvedValue({
      data: { user: { id: userId, email_confirmed_at: "2026-11-11" } },
      error: null,
    });
    const { sub } = await readGrant(
      await POST(request({ gameId, role: "studio" })),
      "studio",
    );
    expect(sub).toBe(`studio-${gameId}`);
    expect(mocks.coach).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("authorize_coach_clip_relay", {
      p_game_id: gameId,
      p_role: "studio",
      p_actor_user_id: userId,
      p_verified_organizer: false,
      p_organization_id: null,
    });
  });

  it("accepts an exact Studio organizer token and does not use it for the coach role", async () => {
    mocks.token.mockResolvedValue({ gameId, purpose: "organizer" });
    const headers = { authorization: "Bearer organizer-fixture" };
    const response = await POST(request({ gameId, role: "studio" }, headers));
    expect((await readGrant(response, "studio")).sub).toBe(`studio-${gameId}`);
    expect(mocks.rpc).toHaveBeenCalledWith("authorize_coach_clip_relay", {
      p_game_id: gameId,
      p_role: "studio",
      p_actor_user_id: null,
      p_verified_organizer: true,
      p_organization_id: null,
    });
    expect(
      (await POST(request({ gameId, role: "coach" }, headers))).status,
    ).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    { gameId, purpose: "participant", role: "scorer" },
    { gameId, purpose: "invitation" },
    { gameId: "other-game", purpose: "organizer" },
  ])("denies an ineligible Studio bearer %j", async (access) => {
    mocks.token.mockResolvedValue(access);
    const response = await POST(
      request({ gameId, role: "studio" }, { authorization: "Bearer fixture" }),
    );
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { gameId, role: "publisher" },
    { gameId: "bad", role: "studio" },
    { gameId, role: "coach", room: "public-room" },
    { gameId, role: "coach", organizationId },
  ])("rejects malformed scope or caller-supplied grant %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects missing, different and explicitly cross-site origins", async () => {
    const body = { gameId, role: "studio" };
    expect((await POST(request(body, {}, false))).status).toBe(403);
    expect(
      (
        await POST(
          request(body, {
            origin: "https://spoof.example",
            host: "spoof.example",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(request(body, { "sec-fetch-site": "cross-site" }))).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("withholds a signed grant if the game or coach becomes unauthorized", async () => {
    mocks.coach.mockResolvedValue({ userId, organizationId });
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({
      error: { code: "42501", message: "private-backend-detail" },
    });
    const response = await POST(request({ gameId, role: "coach" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed when access or configuration is unavailable", async () => {
    mocks.coach.mockResolvedValue({ userId, organizationId });
    const body = { gameId, role: "coach" };
    mocks.rpc.mockResolvedValueOnce({ error: { code: "P0402" } });
    expect((await POST(request(body))).status).toBe(403);
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    const response = await POST(request(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Clip relay is unavailable.",
    });
  });
});
