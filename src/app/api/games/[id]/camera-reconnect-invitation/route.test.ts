import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  prepareCameraReconnect: vi.fn(),
  issueCameraReconnectToken: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  authorizeGame: mocks.authorizeGame,
  operatorRoles: ["owner", "team_admin", "game_operator"],
  authorizationError: () => ({ status: 403, error: "Not authorized" }),
}));
vi.mock("@/lib/store", () => ({
  prepareCameraReconnect: mocks.prepareCameraReconnect,
}));
vi.mock("@/lib/tokens", () => ({
  issueCameraReconnectToken: mocks.issueCameraReconnectToken,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
import { POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const send = (body: unknown = { role: "camera-away" }, gameId = id) =>
  POST(
    new Request(`http://test/api/games/${gameId}/camera-reconnect-invitation`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: gameId }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "preview");
  mocks.authorizeGame.mockResolvedValue({ ok: true });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.prepareCameraReconnect.mockResolvedValue({ deviceId, generation: 3 });
  mocks.issueCameraReconnectToken.mockResolvedValue("synthetic-renewal");
});
describe("camera reconnect invitation", () => {
  it("issues a short-lived fragment link bound to the existing assignment", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(result.url).toBe(
      `http://test/studio-m2/${id}/camera/camera-away#token=synthetic-renewal`,
    );
    expect(Date.parse(result.expiresAt) - Date.now()).toBeLessThanOrEqual(
      600_000,
    );
    expect(mocks.issueCameraReconnectToken).toHaveBeenCalledWith(
      id,
      "camera-away",
      expect.any(String),
      deviceId,
      3,
    );
    const options = mocks.authorizeGame.mock.calls[0][2];
    expect(options.tokenAllowed({ purpose: "organizer" })).toBe(true);
    expect(options.tokenAllowed({ purpose: "participant" })).toBe(false);
    expect(options.tokenAllowed({ purpose: "invitation" })).toBe(false);
  });
  it("rejects malformed games, scorers, and client-supplied device IDs", async () => {
    expect((await send({}, "invalid")).status).toBe(400);
    expect((await send({ role: "scorer" })).status).toBe(400);
    expect((await send({ role: "camera-home", deviceId })).status).toBe(400);
    expect(mocks.prepareCameraReconnect).not.toHaveBeenCalled();
  });
  it("denies unauthorized operators and does not change assignments", async () => {
    mocks.authorizeGame.mockResolvedValue({ ok: false });
    expect((await send()).status).toBe(403);
    expect(mocks.prepareCameraReconnect).not.toHaveBeenCalled();
  });
  it("fails safely for unavailable assignments or storage", async () => {
    mocks.prepareCameraReconnect.mockResolvedValueOnce({
      error: "Camera unavailable",
    });
    expect((await send()).status).toBe(409);
    mocks.prepareCameraReconnect.mockRejectedValueOnce(
      Error("private database failure"),
    );
    const response = await send();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
});
