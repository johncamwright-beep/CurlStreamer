import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ deliver: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/providers/m4-target-delivery", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/providers/m4-target-delivery")
  >()),
  deliverM4Target: mocks.deliver,
  m4TargetHandoffEnabled: mocks.enabled,
}));
import { POST } from "./route";
const gameId = "11111111-1111-4111-8111-111111111111",
  sessionId = "22222222-2222-4222-8222-222222222222",
  intentId = "33333333-3333-4333-8333-333333333333";
const bearer = "b".repeat(43),
  body = { sessionId, generation: 2, intentId };
const result = {
  ...body,
  expiresAt: "2026-09-08T14:00:00Z",
  leaseExpiresAt: "2026-09-08T10:00:30Z",
  target: {
    serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
    streamKey: "private-key",
  },
};
const context = { params: Promise.resolve({ id: gameId }) };
function request(
  value: unknown = body,
  headers: HeadersInit = { authorization: `Bearer ${bearer}` },
) {
  return new Request("https://pilot.example/target", {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.deliver.mockResolvedValue(result);
});
describe("restricted sensitive desktop target response", () => {
  it("projects only target and deadline envelope, never caches or sets cookies", async () => {
    mocks.deliver.mockResolvedValue({
      ...result,
      bearer,
      refreshToken: "private-refresh",
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.deliver).toHaveBeenCalledExactlyOnceWith(
      gameId,
      { sessionId, generation: 2, bearer },
      intentId,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  it.each<HeadersInit>([
    {},
    { cookie: "account=valid" },
    { authorization: "Bearer participant" },
    { authorization: `Bearer ${bearer} trailing` },
    { authorization: `Bearer ${bearer}`, origin: "https://pilot.example" },
    { authorization: `Bearer ${bearer}`, "sec-fetch-site": "none" },
  ])("rejects absent capability or browser request", async (headers) => {
    expect((await POST(request(body, headers), context)).status).toBe(403);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, generation: 0 },
    { ...body, generation: 1.5 },
    { ...body, intentId: "bad" },
    { ...body, streamKey: "supplied" },
    { ...body, gameId },
  ])("rejects invalid or extra body fields", async (value) => {
    expect((await POST(request(value), context)).status).toBe(400);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("denies disabled delivery", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(503);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it.each([
    { ...result, sessionId: gameId },
    { ...result, intentId: gameId },
    { ...result, generation: 1 },
    { ...result, target: { ...result.target, serverUrl: "rtmp://other" } },
  ])("does not release mismatched or unsafe destination", async (value) => {
    mocks.deliver.mockResolvedValue(value);
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-key");
  });
  it.each([
    ["42501", 403],
    ["55000", 409],
    ["other", 503],
  ])("sanitizes provider errors %s", async (code, status) => {
    mocks.deliver.mockRejectedValue(
      Object.assign(new Error("private-key"), { code }),
    );
    const response = await POST(request(), context);
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private-key");
  });
});
