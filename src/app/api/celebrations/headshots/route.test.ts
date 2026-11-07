import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  context: vi.fn(),
  authorize: vi.fn(),
  organization: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  saveCoach: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: m.context,
}));
vi.mock("@/lib/game-authorization", () => ({
  authorizeGame: m.authorize,
  authorizationError: () => ({ error: "Game access required", status: 403 }),
  operatorRoles: ["owner", "team_admin", "game_operator", "scorer"],
}));
vi.mock("@/lib/providers/celebration-headshots", async () => {
  const { z } = await import("zod");
  return {
    headshotInputSchema: z.object({
      playerId: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    coachHeadshotInputSchema: z
      .object({
        kind: z.literal("coach"),
        playerName: z.string().trim().min(1).max(100),
        playerId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    celebrationGameOrganization: m.organization,
    readCelebrationHeadshots: m.read,
    saveCelebrationHeadshot: m.save,
    saveCelebrationCoachHeadshot: m.saveCoach,
    removeCelebrationHeadshot: m.remove,
  };
});
import { GET, POST, DELETE } from "./route";
const gameId = "11111111-1111-4111-8111-111111111111";
const headshotId = "22222222-2222-4222-8222-222222222222";
function get(game = gameId) {
  return new Request("https://test/api/celebrations/headshots?gameId=" + game);
}
function post(origin = "https://test", game = gameId) {
  const form = new FormData();
  form.append("playerId", "a".repeat(64));
  form.append("gameId", game);
  form.append("image", new File(["PNG"], "head.png", { type: "image/png" }));
  return new Request("https://test/api/celebrations/headshots", {
    method: "POST",
    headers: { origin },
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.context.mockResolvedValue({ organizationId: "team-a", role: "owner" });
  m.authorize.mockResolvedValue({ ok: true, via: "account" });
  m.organization.mockResolvedValue("team-a");
  m.read.mockResolvedValue({ players: [], headshots: [] });
  m.save.mockResolvedValue({ players: [], headshots: [] });
  m.saveCoach.mockResolvedValue({ players: [], headshots: [] });
  m.remove.mockResolvedValue({ players: [], headshots: [] });
});
it("requires game authorization before loading its organization or photos", async () => {
  m.authorize.mockResolvedValue({ ok: false, reason: "unauthorized" });
  expect((await GET(get())).status).toBe(403);
  expect(m.organization).not.toHaveBeenCalled();
  expect(m.read).not.toHaveBeenCalled();
});
it("loads the game's roster even when the active team differs and forbids editing", async () => {
  m.organization.mockResolvedValue("team-b");
  const response = await GET(get());
  expect(response.status).toBe(200);
  expect(m.read).toHaveBeenCalledWith("team-b");
  expect(await response.json()).toMatchObject({ canEdit: false });
});
it("rejects invalid game identifiers before authorization", async () => {
  expect((await GET(get("bad"))).status).toBe(400);
  expect(m.authorize).not.toHaveBeenCalled();
});
it("requires same-origin writes and verified team administrator", async () => {
  expect((await POST(post("https://other"))).status).toBe(403);
  expect(m.context).not.toHaveBeenCalled();
  m.context.mockResolvedValue(null);
  expect((await POST(post())).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});
it("rejects a cross-team game's upload despite valid account access", async () => {
  m.organization.mockResolvedValue("team-b");
  expect((await POST(post())).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});
it("saves only under the authenticated team's organization", async () => {
  expect((await POST(post())).status).toBe(200);
  expect(m.save).toHaveBeenCalledWith(
    "team-a",
    "a".repeat(64),
    expect.any(File),
  );
});
it("removes only a scoped headshot after administrator authorization", async () => {
  const request = new Request("https://test/api/celebrations/headshots", {
    method: "DELETE",
    headers: { origin: "https://test", "content-type": "application/json" },
    body: JSON.stringify({ headshotId, gameId }),
  });
  expect((await DELETE(request)).status).toBe(200);
  expect(m.remove).toHaveBeenCalledWith("team-a", headshotId);
});
it("denies cross-game deletion before storage changes", async () => {
  m.authorize.mockResolvedValue({ ok: false, reason: "unauthorized" });
  const request = new Request("https://test/api/celebrations/headshots", {
    method: "DELETE",
    headers: { origin: "https://test", "content-type": "application/json" },
    body: JSON.stringify({ headshotId, gameId }),
  });
  expect((await DELETE(request)).status).toBe(403);
  expect(m.remove).not.toHaveBeenCalled();
});
it("allows only organizer and current scorer tokens to list game faces without account cookies", async () => {
  m.context.mockRejectedValue(Error("optional account unavailable"));
  const response = await GET(get());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ canEdit: false });
  const options = m.authorize.mock.calls[0][2];
  expect(options.tokenAllowed({ purpose: "organizer" })).toBe(true);
  expect(options.tokenAllowed({ purpose: "participant", role: "scorer" })).toBe(
    true,
  );
  expect(
    options.tokenAllowed({ purpose: "participant", role: "camera-home" }),
  ).toBe(false);
  expect(options.tokenAllowed({ purpose: "invitation", role: "scorer" })).toBe(
    false,
  );
});
function coachPost(name = "Coach Sample", kind = "coach") {
  const form = new FormData();
  form.append("kind", kind);
  form.append("playerName", name);
  form.append("gameId", gameId);
  form.append("image", new File(["PNG"], "coach.png", { type: "image/png" }));
  return new Request("https://test/api/celebrations/headshots", {
    method: "POST",
    headers: { origin: "https://test" },
    body: form,
  });
}
it("requires administrator authorization before creating a coach and rejects invalid person kinds", async () => {
  m.context.mockResolvedValue(null);
  expect((await POST(coachPost())).status).toBe(403);
  expect(m.context).toHaveBeenCalledWith(true);
  expect(m.saveCoach).not.toHaveBeenCalled();
  m.context.mockResolvedValue({ organizationId: "team-a", role: "owner" });
  expect((await POST(coachPost("Sample", "owner"))).status).toBe(400);
  expect(m.saveCoach).not.toHaveBeenCalled();
});
it("validates coach names and saves only within the authenticated game's organization", async () => {
  for (const name of [" ", "x".repeat(101)])
    expect((await POST(coachPost(name))).status).toBe(400);
  expect((await POST(coachPost())).status).toBe(200);
  expect(m.saveCoach).toHaveBeenCalledWith(
    "team-a",
    { kind: "coach", playerName: "Coach Sample" },
    expect.any(File),
  );
  m.organization.mockResolvedValue("team-b");
  expect((await POST(coachPost())).status).toBe(403);
  expect(m.saveCoach).toHaveBeenCalledTimes(1);
});
