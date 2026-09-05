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
import { GameStateConflictError } from "@/lib/game-state-conflict";
const request = () =>
  new Request("http://test/api/games/game-1/disconnect-camera", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "camera-home" }),
  });
describe("temporary organizer camera disconnect", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "account",
      role: "owner",
      organizationId: "team-1",
    });
    mocks.getGame.mockResolvedValue({ claims: { "camera-home": "device-1" } });
    mocks.updateGame.mockResolvedValue({
      claims: { "camera-home": "device-1" },
      cameraHealth: { "camera-home": { phase: "disconnected" } },
    });
  });
  it("removes LiveKit participation but retains the reserved claim", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.removeCameraParticipant).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      undefined,
    );
    expect(mocks.updateGame).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ type: "camera-health", phase: "disconnected" }),
      { role: "camera-home", claim: "device-1", generation: undefined },
    );
    expect((await response.json()).game.claims["camera-home"]).toBe("device-1");
  });
  it("is idempotent when already unclaimed", async () => {
    mocks.getGame.mockResolvedValue({ claims: {} });
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "game-1" }) }))
        .status,
    ).toBe(200);
    expect(mocks.removeCameraParticipant).not.toHaveBeenCalled();
  });
  it("does not report success on a genuine LiveKit failure", async () => {
    mocks.removeCameraParticipant.mockRejectedValue(new Error("service"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "game-1" }) }))
        .status,
    ).toBe(503);
    expect(mocks.updateGame).not.toHaveBeenCalled();
  });
  it("returns a useful conflict when camera state loses a version race", async () => {
    mocks.updateGame.mockRejectedValue(new GameStateConflictError());
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "The game changed before the camera state was saved. Try again.",
    });
  });
});
