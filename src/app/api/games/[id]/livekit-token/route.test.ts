import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  getGame: vi.fn(),
  readGame: vi.fn(),
  issueLiveKitToken: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  operatorRoles: ["owner", "team_admin", "scorer"],
  authorizeGame: mocks.authorizeGame,
  authorizationError: (result: { reason: string }) => ({
    error:
      result.reason === "not-found"
        ? "Game not found"
        : result.reason === "deleted"
          ? "This game has been deleted and is unavailable."
          : result.reason === "closed"
            ? "This game is closed"
            : result.reason === "unavailable"
              ? "Game service is temporarily unavailable"
              : result.reason,
    status:
      result.reason === "not-found"
        ? 404
        : result.reason === "closed" || result.reason === "deleted"
          ? 410
          : result.reason === "unavailable"
            ? 503
            : 401,
  }),
}));
vi.mock("@/lib/store", () => ({ getGame: mocks.getGame }));
vi.mock("@/lib/providers/game-read", () => ({ readGame: mocks.readGame }));
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
    mocks.readGame.mockResolvedValue({
      kind: "active",
      game: { status: "active" },
    });
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

  it("issues a no-store subscriber credential for an active anonymous Broadcast", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
      anonymous: true,
    });
    const request = new Request(
      "https://preview.example/api/games/scheduled-game/livekit-token?view=broadcast",
      { method: "POST" },
    );
    const response = await POST(request, {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(mocks.readGame).toHaveBeenCalledWith("scheduled-game");
    expect(mocks.issueLiveKitToken).toHaveBeenCalledWith(
      "scheduled-game",
      "broadcast-viewer",
    );
    expect(mocks.getGame).not.toHaveBeenCalled();
  });

  it.each([
    ["not-found", 404, "Game not found"],
    ["deleted", 410, "This game has been deleted and is unavailable."],
    ["closed", 410, "This game is closed"],
  ] as const)(
    "denies a %s anonymous Broadcast game",
    async (kind, status, error) => {
      mocks.authorizeGame.mockResolvedValue({
        ok: false,
        reason: "unauthorized",
        anonymous: true,
      });
      mocks.readGame.mockResolvedValue({ kind });
      const response = await POST(
        new Request(
          "https://preview.example/api/games/scheduled-game/livekit-token?view=broadcast",
          { method: "POST" },
        ),
        { params: Promise.resolve({ id: "scheduled-game" }) },
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
    },
  );

  it("fails closed when anonymous Broadcast lifecycle state is unavailable", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
      anonymous: true,
    });
    mocks.readGame.mockRejectedValue(new Error("private provider detail"));
    const response = await POST(
      new Request(
        "https://preview.example/api/games/scheduled-game/livekit-token?view=broadcast",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "scheduled-game" }) },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Game service is temporarily unavailable",
    });
    expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
  });

  it("does not treat invalid credentials or an ordinary anonymous request as Broadcast access", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });
    for (const url of [
      "https://preview.example/api/games/scheduled-game/livekit-token?view=broadcast",
      "https://preview.example/api/games/scheduled-game/livekit-token",
    ]) {
      const response = await POST(new Request(url, { method: "POST" }), {
        params: Promise.resolve({ id: "scheduled-game" }),
      });
      expect(response.status).toBe(401);
    }
    expect(mocks.readGame).not.toHaveBeenCalled();
    expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
  });
});
