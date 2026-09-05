import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  removeCameraParticipant: vi.fn(),
  getGame: vi.fn(),
  releaseRole: vi.fn(),
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
  releaseRole: mocks.releaseRole,
}));

import { POST } from "./route";

function request(role = "camera-home", token = "token") {
  return new Request("http://test/api/games/game-1/release-camera", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
}

describe("explicit organizer camera release route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "token",
      access: { purpose: "organizer", gameId: "game-1" },
    });
    mocks.getGame.mockResolvedValue({
      claims: { "camera-home": "claimed" },
      claimGenerations: { "camera-home": 3 },
    });
    mocks.releaseRole.mockResolvedValue({
      released: true,
      releasedGeneration: 3,
      game: { claims: {} },
    });
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

  it("rejects an incorrect role and treats an unclaimed role idempotently", async () => {
    expect(
      (
        await POST(request("scorer"), {
          params: Promise.resolve({ id: "game-1" }),
        })
      ).status,
    ).toBe(400);
    const unclaimed = await POST(request("camera-away"), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(unclaimed.status).toBe(200);
    expect(await unclaimed.json()).toMatchObject({ released: false });
    expect(mocks.removeCameraParticipant).not.toHaveBeenCalled();
  });

  it("removes the selected participant and clears the device claim", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.removeCameraParticipant).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      3,
    );
    expect(mocks.releaseRole).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      "claimed",
      3,
    );
  });

  it("does not clean up or release a newer same-device generation", async () => {
    mocks.releaseRole.mockResolvedValue({ error: "Camera claim changed" });
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.releaseRole).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      "claimed",
      3,
    );
    expect(mocks.removeCameraParticipant).not.toHaveBeenCalled();
  });

  it("releases an offline claim when LiveKit reports participant not found", async () => {
    mocks.removeCameraParticipant.mockResolvedValue(undefined);
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "game-1" }) }))
        .status,
    ).toBe(200);
    expect(mocks.releaseRole).toHaveBeenCalledOnce();
  });

  it("keeps the database revocation authoritative when provider removal fails", async () => {
    mocks.removeCameraParticipant.mockRejectedValue(
      new Error("service failed"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      released: true,
      providerCleanup: { status: "failed" },
    });
    expect(mocks.releaseRole).toHaveBeenCalledOnce();
  });
});
