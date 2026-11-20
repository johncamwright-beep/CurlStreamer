import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  game: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  authorizeGame: mocks.authorize,
  authorizationError: () => ({ error: "Denied", status: 403 }),
  operatorRoles: ["owner", "team_admin", "scorer"],
}));
vi.mock("@/lib/store", () => ({ getGame: mocks.game }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: mocks.query }) }),
  }),
}));
import { GET } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const get = () =>
  GET(new Request("https://test/api/games/" + id + "/studio-devices"), {
    params: Promise.resolve({ id }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.game.mockResolvedValue({
    claims: { "camera-home": "phone" },
    claimGenerations: { "camera-home": 2 },
  });
});
describe("private Studio device status", () => {
  it("does not read session data without game authorization", async () => {
    mocks.authorize.mockResolvedValue({ ok: false });
    expect((await get()).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("reports only current assignment heartbeats, without device identifiers", async () => {
    mocks.query.mockResolvedValue({
      data: [
        {
          camera_role: "camera-home",
          status: "active",
          receiver_seen_at: new Date().toISOString(),
          camera_seen_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          camera_device_id: "phone",
          assignment_generation: 2,
        },
      ],
    });
    const result = await get();
    const body = await result.json();
    expect(body.cameras["camera-home"]).toEqual({
      receiverReady: true,
      phoneOnline: true,
    });
    expect(JSON.stringify(body)).not.toContain("camera_device_id");
    expect(mocks.query).toHaveBeenCalledWith("game_id", id);
  });
  it("does not mistake an old assignment for a current connection", async () => {
    mocks.query.mockResolvedValue({
      data: [
        {
          camera_role: "camera-home",
          status: "active",
          receiver_seen_at: new Date().toISOString(),
          camera_seen_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          camera_device_id: "phone",
          assignment_generation: 1,
        },
      ],
    });
    expect((await (await get()).json()).cameras["camera-home"]).toEqual({
      receiverReady: true,
      phoneOnline: false,
    });
  });
  it("reports expired receiver sessions as inactive", async () => {
    mocks.query.mockResolvedValue({
      data: [
        {
          camera_role: "camera-home",
          status: "active",
          receiver_seen_at: new Date(Date.now() - 31000).toISOString(),
          camera_seen_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          camera_device_id: "phone",
          assignment_generation: 2,
        },
      ],
    });
    expect((await (await get()).json()).cameras["camera-home"]).toEqual({
      receiverReady: false,
      phoneOnline: false,
    });
  });
});
