import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/providers/m4-desktop-authority", () => ({
  m4DesktopEnabled: mocks.enabled,
}));
vi.mock("@/lib/providers/m4-output-intent", () => ({
  claimM4OutputIntent: mocks.claim,
}));
import { POST } from "./route";
const gameId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const bearer = "b".repeat(43);
const body = { sessionId, generation: 2, intentId };
const result = { ...body, phase: "reserved", deliveryRecorded: false };
const context = { params: Promise.resolve({ id: gameId }) };
function request(
  value: unknown = body,
  headers: HeadersInit = { authorization: `Bearer ${bearer}` },
) {
  return new Request(
    `https://pilot.example/api/games/${gameId}/studio-m4/desktop/output-intent`,
    { method: "POST", headers, body: JSON.stringify(value) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.claim.mockResolvedValue(result);
});
describe("restricted desktop output-intent claim", () => {
  it("passes exact scoped authority and returns only a reserved journal result", async () => {
    mocks.claim.mockResolvedValue({
      ...result,
      bearer,
      streamKey: "secret",
      outputActive: true,
      credentials: { refreshToken: "secret" },
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith(
      gameId,
      { sessionId, generation: 2, bearer },
      intentId,
    );
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each<HeadersInit>([
    {},
    { cookie: "account=valid; curlcast_m3_program=valid" },
    { authorization: "Bearer camera-participant-token" },
    { authorization: `Basic ${bearer}` },
    { authorization: `Bearer ${bearer} trailing` },
    { "x-desktop-bearer": bearer },
  ])(
    "never substitutes cookies or alternative headers for restricted bearer",
    async (headers) => {
      expect((await POST(request(body, headers), context)).status).toBe(403);
      expect(mocks.claim).not.toHaveBeenCalled();
    },
  );
  it.each<HeadersInit>([
    { origin: "https://pilot.example" },
    { origin: "null" },
    { "sec-fetch-site": "none" },
  ])(
    "rejects browser-marked calls even with valid bearer shape",
    async (headers) => {
      expect(
        (
          await POST(
            request(body, {
              ...(headers as Record<string, string>),
              authorization: `Bearer ${bearer}`,
            }),
            context,
          )
        ).status,
      ).toBe(403);
      expect(mocks.claim).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...body, generation: 0 },
    { ...body, generation: 1.5 },
    { ...body, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...body, sessionId: "bad" },
    { ...body, intentId: "bad" },
    { ...body, bearer },
    { ...body, action: "start" },
    { ...body, gameId },
  ])("rejects invalid input and authority/output overrides", async (value) => {
    expect((await POST(request(value), context)).status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("rejects invalid game identifiers and malformed JSON", async () => {
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "bad" }) }))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request("https://pilot.example", { method: "POST", body: "{" }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("requires feature enablement before reserving an intent", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(503);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it.each(["42501", "55000", "unexpected"])(
    "maps provider failure %s without exposing credentials",
    async (code) => {
      mocks.claim.mockRejectedValue(
        Object.assign(Error(`secret ${bearer}`), {
          code,
          details: "rtmps://secret.invalid",
        }),
      );
      const response = await POST(request(), context);
      expect(response.status).toBe(
        code === "42501" ? 403 : code === "55000" ? 409 : 503,
      );
      expect(await response.json()).toEqual({
        error: "Desktop authority is unavailable.",
        code: "m4_desktop_unavailable",
      });
    },
  );
  it.each([
    { ...result, deliveryRecorded: true },
    { ...result, phase: "live" },
    { ...result, intentId: gameId },
    { ...result, sessionId: gameId },
    { ...result, generation: 3 },
  ])(
    "fails closed for impossible or differently scoped provider responses",
    async (value) => {
      mocks.claim.mockResolvedValue(value);
      expect((await POST(request(), context)).status).toBe(503);
    },
  );
  it.each(["quarantined", "stop_requested"])(
    "reports %s without implying live output",
    async (phase) => {
      mocks.claim.mockResolvedValue({
        ...result,
        phase,
        deliveryRecorded: true,
      });
      expect(await (await POST(request(), context)).json()).toEqual({
        ...result,
        phase,
        deliveryRecorded: true,
      });
    },
  );
});
