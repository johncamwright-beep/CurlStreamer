import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  removeCameraParticipant: vi.fn(),
  getGame: vi.fn(),
  updateGame: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  operatorRoles: ["owner", "team_admin", "scorer"],
  authorizeGame: mocks.authorizeGame,
  authorizationError: () => ({ error: "Game access is required", status: 403 }),
}));
vi.mock("@/lib/providers/livekit", () => ({
  removeCameraParticipant: mocks.removeCameraParticipant,
}));
vi.mock("@/lib/store", () => ({
  getGame: mocks.getGame,
  updateGame: mocks.updateGame,
}));

import { POST } from "./route";

function request(role = "camera-home", token = "token") {
  return new Request("http://test/api/games/game-1/disconnect-camera", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
}

describe("organizer camera disconnect route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "token",
      access: { purpose: "organizer", gameId: "game-1" },
    });
    mocks.getGame.mockResolvedValue({ claims: { "camera-home": "claimed" } });
  });

  it("requires organizer authorization for the same game", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "game-1" }) }))
        .status,
    ).toBe(403);
    mocks.authorizeGame.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "game-1" }) }))
        .status,
    ).toBe(403);
    expect(mocks.removeCameraParticipant).not.toHaveBeenCalled();
  });

  it("rejects an incorrect or unclaimed role", async () => {
    expect(
      (
        await POST(request("scorer"), {
          params: Promise.resolve({ id: "game-1" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(request("camera-away"), {
          params: Promise.resolve({ id: "game-1" }),
        })
      ).status,
    ).toBe(409);
    expect(mocks.removeCameraParticipant).not.toHaveBeenCalled();
  });

  it("removes the selected participant and persists disconnected", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.removeCameraParticipant).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
    );
    expect(mocks.updateGame).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ role: "camera-home", phase: "disconnected" }),
    );
  });
});
