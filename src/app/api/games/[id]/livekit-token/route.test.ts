import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  getGame: vi.fn(),
  issueLiveKitToken: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  operatorRoles: ["owner", "team_admin", "scorer"],
  authorizeGame: mocks.authorizeGame,
  authorizationError: (result: { reason: string }) => ({
    error: result.reason,
    status:
      result.reason === "closed" || result.reason === "deleted" ? 410 : 401,
  }),
}));
vi.mock("@/lib/store", () => ({ getGame: mocks.getGame }));
vi.mock("@/lib/providers/livekit", () => ({
  issueLiveKitToken: mocks.issueLiveKitToken,
  LiveKitConfigurationError: class extends Error {},
}));

import { POST } from "./route";

const cameraRequest = (id = "scheduled-game") =>
  new Request(`https://preview.example/api/games/${id}/livekit-token`, {
    method: "POST",
    headers: { authorization: "Bearer device-bound-participant" },
  });

describe("camera LiveKit token route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "token",
      access: {
        purpose: "participant",
        gameId: "scheduled-game",
        role: "camera-home",
        deviceId: "device-1",
      },
    });
    mocks.getGame.mockResolvedValue({ status: "active" });
    mocks.issueLiveKitToken.mockResolvedValue({
      url: "wss://live.example",
      token: "livekit-room-token",
    });
  });

  it("issues Camera 1 credentials using only its participant bearer", async () => {
    const request = cameraRequest();
    const response = await POST(request, {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "wss://live.example",
      token: "livekit-room-token",
    });
    expect(mocks.authorizeGame).toHaveBeenCalledWith(
      request,
      "scheduled-game",
      expect.objectContaining({
        accountRoles: ["owner", "team_admin", "scorer"],
      }),
    );
    expect(mocks.issueLiveKitToken).toHaveBeenCalledWith(
      "scheduled-game",
      "camera-home",
    );
  });

  it.each(["wrong-game", "expired", "deleted", "closed"])(
    "rejects a %s credential before LiveKit signing",
    async (reason) => {
      mocks.authorizeGame.mockResolvedValue({ ok: false, reason });
      const response = await POST(cameraRequest(), {
        params: Promise.resolve({ id: "scheduled-game" }),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
    },
  );
});
