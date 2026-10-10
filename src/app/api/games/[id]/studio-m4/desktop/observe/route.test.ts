import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ observe: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/providers/m4-desktop-observation", async (original) => ({
  ...(await original<
    typeof import("@/lib/providers/m4-desktop-observation")
  >()),
  observeM4DesktopOutput: mocks.observe,
  m4DesktopObservationEnabled: mocks.enabled,
}));
import { POST } from "./route";
const gameId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const bearer = "b".repeat(43);
const body = { sessionId, generation: 2, intentId };
const result = {
  ...body,
  streamStatus: "active",
  healthStatus: "good",
  broadcastStatus: "live",
  broadcastLive: true,
};
const context = { params: Promise.resolve({ id: gameId }) };
function request(
  value: unknown = body,
  headers: HeadersInit = { authorization: `Bearer ${bearer}` },
) {
  return new Request("https://pilot.example/observe", {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.observe.mockResolvedValue(result);
});
describe("restricted desktop provider observation", () => {
  it("returns only the observation receipt and never caches or exposes credentials", async () => {
    mocks.observe.mockResolvedValue({
      ...result,
      refreshToken: "secret-refresh",
      channelId: "private-channel",
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mocks.observe).toHaveBeenCalledWith(
      gameId,
      { sessionId, generation: 2, bearer },
      intentId,
    );
  });
  it.each<HeadersInit>([
    {},
    { cookie: "account=valid" },
    { authorization: "Bearer participant" },
    { authorization: `Bearer ${bearer} trailing` },
    { authorization: `Bearer ${bearer}`, origin: "https://pilot.example" },
    { authorization: `Bearer ${bearer}`, "sec-fetch-site": "none" },
  ])("denies browser or missing desktop bearer", async (headers) => {
    expect((await POST(request(body, headers), context)).status).toBe(403);
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, generation: 0 },
    { ...body, generation: 1.5 },
    { ...body, intentId: "bad" },
    { ...body, provider: "youtube" },
  ])("rejects malformed or extended input", async (value) => {
    expect((await POST(request(value), context)).status).toBe(400);
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it("denies the route while observation is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(503);
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it.each([
    { ...result, sessionId: gameId },
    { ...result, intentId: gameId },
    { ...result, generation: 1 },
    { ...result, broadcastLive: true, broadcastStatus: "ready" },
  ])(
    "does not project a mismatched or optimistic provider result",
    async (value) => {
      mocks.observe.mockResolvedValue(value);
      const response = await POST(request(), context);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("secret");
    },
  );
  it.each([
    ["42501", 403],
    ["55000", 409],
    ["other", 503],
  ])("sanitizes provider failure %s", async (code, status) => {
    mocks.observe.mockRejectedValue(
      Object.assign(new Error("secret-refresh"), { code }),
    );
    const response = await POST(request(), context);
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("secret-refresh");
  });
});
