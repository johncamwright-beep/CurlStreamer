import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  getGame: vi.fn(),
  readGame: vi.fn(),
  issueLiveKitToken: vi.fn(),
  terminateGameLiveKit: vi.fn(),
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
  terminateGameLiveKit: mocks.terminateGameLiveKit,
  LiveKitConfigurationError: class extends Error {},
}));

import { POST } from "./route";

const cameraRequest = (id = "scheduled-game") =>
  new Request(`https://preview.example/api/games/${id}/livekit-token`, {
    method: "POST",
    headers: { authorization: "Bearer device-bound-participant" },
  });
const capabilityRequest = (
  capability: "camera-publish" | "preview-subscribe" | "public-viewer",
  bearer?: string,
) =>
  new Request(
    `https://preview.example/api/games/scheduled-game/livekit-token?capability=${capability}`,
    {
      method: "POST",
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    },
  );

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
    mocks.terminateGameLiveKit.mockResolvedValue(undefined);
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
        accountRoles: [],
      }),
    );
    expect(mocks.issueLiveKitToken).toHaveBeenCalledWith(
      "scheduled-game",
      "camera-home",
    );
  });

  it("does not let legacy account fallback replace a released camera bearer", async () => {
    mocks.authorizeGame
      .mockResolvedValueOnce({ ok: false, reason: "released" })
      .mockResolvedValueOnce({ ok: true, via: "account", role: "owner" });
    const response = await POST(cameraRequest(), {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.authorizeGame).toHaveBeenCalledOnce();
    expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
  });

  it("issues explicit camera-publish using token-only authority", async () => {
    const request = capabilityRequest(
      "camera-publish",
      "device-bound-participant",
    );
    const response = await POST(request, {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.authorizeGame).toHaveBeenCalledWith(
      request,
      "scheduled-game",
      expect.objectContaining({ accountRoles: [] }),
    );
    expect(mocks.issueLiveKitToken).toHaveBeenCalledWith(
      "scheduled-game",
      "camera-home",
    );
  });

  it.each(["unauthorized", "released"])(
    "does not issue camera-publish after %s participant validation",
    async (reason) => {
      mocks.authorizeGame.mockResolvedValue({ ok: false, reason });
      const response = await POST(
        capabilityRequest("camera-publish", "invalid-camera"),
        { params: Promise.resolve({ id: "scheduled-game" }) },
      );
      expect(response.status).toBe(401);
      expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["account", { ok: true, via: "account", role: "owner" }],
    [
      "organizer",
      {
        ok: true,
        via: "token",
        access: { purpose: "organizer", gameId: "scheduled-game" },
      },
    ],
    [
      "scorer participant",
      {
        ok: true,
        via: "token",
        access: {
          purpose: "participant",
          gameId: "scheduled-game",
          role: "scorer",
          deviceId: "scorer-device",
        },
      },
    ],
  ] as const)(
    "issues subscribe-only preview access for %s",
    async (_label, auth) => {
      mocks.authorizeGame.mockResolvedValue(auth);
      const response = await POST(capabilityRequest("preview-subscribe"), {
        params: Promise.resolve({ id: "scheduled-game" }),
      });
      expect(response.status).toBe(200);
      expect(mocks.issueLiveKitToken).toHaveBeenCalledWith(
        "scheduled-game",
        "preview-subscriber",
      );
    },
  );

  it("issues explicit credential-free public viewer access", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
      anonymous: true,
    });
    const response = await POST(capabilityRequest("public-viewer"), {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.issueLiveKitToken).toHaveBeenCalledWith(
      "scheduled-game",
      "public-viewer",
    );
  });

  it("rejects public-viewer when account or credential context is present", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });
    const response = await POST(capabilityRequest("public-viewer"), {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
  });

  it("does not return a token when completion wins the signing race", async () => {
    mocks.readGame
      .mockResolvedValueOnce({ kind: "active", game: { status: "active" } })
      .mockResolvedValueOnce({ kind: "completed", completion: {} });
    const response = await POST(cameraRequest(), {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(410);
    expect(mocks.issueLiveKitToken).toHaveBeenCalledOnce();
    expect(mocks.terminateGameLiveKit).toHaveBeenCalledWith("scheduled-game");
    expect(await response.json()).not.toHaveProperty("token");
  });

  it("denies an already-completed game before signing", async () => {
    mocks.readGame.mockResolvedValue({ kind: "completed", completion: {} });
    const response = await POST(cameraRequest(), {
      params: Promise.resolve({ id: "scheduled-game" }),
    });
    expect(response.status).toBe(410);
    expect(mocks.issueLiveKitToken).not.toHaveBeenCalled();
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
