import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  rpc: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock("@/lib/curlcoach/access", () => ({
  labEnabled: () => false,
  sameOrigin: (r: Request) => r.headers.get("origin") === "http://localhost",
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/providers/curlcoach-store", () => ({
  loadCoachState: m.load,
  saveCoachState: m.save,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    rpc: m.rpc,
  }),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  readTeamSettings: async () => ({ settings: {} }),
}));
vi.mock("@/lib/providers/player-contacts", () => ({ rosterPlayers: () => [] }));
import { GET, POST } from "./route";
const gameId = "00000000-0000-4000-8000-000000000001",
  shotId = "00000000-0000-4000-8000-000000000002";
const body = {
  shotId,
  expectedRevision: 1,
  review: {
    version: 1,
    id: "00000000-0000-4000-8000-000000000003",
    gameId,
    audience: "team",
    notes: "Review",
    selectedAt: "2026-11-09T20:00:10Z",
    capturedAt: "2026-11-09T20:01:00Z",
    timingEstimated: true,
  },
};
const request = (origin = "http://localhost") =>
  new Request("http://localhost/api/curlcoach/local-review", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.rpc.mockImplementation(async (name: string) =>
    name === "list_team_hierarchy_games" ? m.catalog() : { error: null },
  );
  m.catalog.mockResolvedValue({
    data: [{ id: gameId, event_id: null }],
    error: null,
  });
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  m.account.mockResolvedValue({
    organizationId: "org",
    userId: "actor",
    user: { id: "actor" },
  });
  m.load.mockResolvedValue({
    revision: 1,
    status: "open",
    events: [{ shotId, shot: { playerId: "lead", grade: 3, note: "" } }],
    roster: [{ id: "lead", name: "Lead" }],
  });
});
afterEach(() => vi.unstubAllEnvs());
it("uses server-owned identity and an authorized game read before writing", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.load).toHaveBeenCalledWith(
    { organizationId: "org", actorUserId: "actor", gameId },
    expect.anything(),
  );
  expect(m.save).toHaveBeenCalledWith(
    { organizationId: "org", actorUserId: "actor", gameId },
    expect.anything(),
    expect.objectContaining({
      shot: expect.objectContaining({
        playerId: "lead",
        grade: 3,
        flagAudience: "team",
      }),
    }),
  );
});
it("rejects cross-origin writes, unavailable accounts and game authorization failure", async () => {
  expect((await POST(request("https://other.test"))).status).toBe(403);
  expect(m.load).not.toHaveBeenCalled();
  m.account.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  m.account.mockResolvedValue({
    organizationId: "org",
    userId: "actor",
    user: { id: "actor" },
  });
  m.load.mockRejectedValue(Error("private diagnostic"));
  const result = await GET(
    new Request(`http://localhost/api/curlcoach/local-review?game=${gameId}`),
  );
  expect(result.status).toBe(403);
  expect(await result.text()).not.toContain("private diagnostic");
  expect(m.catalog).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(409);
  expect(m.save).not.toHaveBeenCalled();
});

it("saves standalone team flags without creating attempts and rejects unknown players", async () => {
  m.load.mockResolvedValue({
    revision: 0,
    status: "open",
    events: [],
    roster: [{ id: "lead", name: "Alex" }],
  });
  const req = (
    audience: string,
    playerId?: string,
    shotContext?: { end: number; shot: number },
  ) =>
    new Request("http://localhost/api/curlcoach/local-review", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        shotId: null,
        expectedRevision: 0,
        playerId,
        review: { ...body.review, audience, shotContext },
      }),
    });
  expect((await POST(req("team", undefined, { end: 4, shot: 7 }))).status).toBe(
    200,
  );
  expect(m.save).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledWith(
    "save_standalone_review",
    expect.objectContaining({
      p_actor: "actor",
      p_org: "org",
      p_game: gameId,
      p_player: null,
      p_selected: body.review.selectedAt,
      p_end: 4,
      p_shot: 7,
    }),
  );
  expect((await POST(req("team", undefined, { end: 0, shot: 7 }))).status).toBe(
    400,
  );
  expect((await POST(req("player", "lead", { end: 4, shot: 7 }))).status).toBe(
    400,
  );
  expect((await POST(req("player", "intruder"))).status).toBe(400);
  expect((await POST(req("player", "lead"))).status).toBe(200);
  expect(m.rpc).toHaveBeenLastCalledWith(
    "save_standalone_review",
    expect.objectContaining({ p_player: "lead", p_name: "Alex" }),
  );
  expect(m.rpc.mock.lastCall?.[1]).not.toHaveProperty("p_end");
});

const loadRequest = () =>
  new Request("http://localhost/api/curlcoach/local-review?game=" + gameId);

it("returns the matching game event through the authorized team catalog", async () => {
  const res = await GET(loadRequest());
  expect(res.status).toBe(200);
  expect((await res.json()).eventId).toBe("standalone");
  expect(m.rpc).toHaveBeenCalledWith("list_team_hierarchy_games", {
    p_user_id: "actor",
  });
  m.catalog.mockResolvedValue({
    data: [
      { id: shotId, event_id: null },
      { id: gameId, event_id: shotId },
    ],
    error: null,
  });
  expect((await (await GET(loadRequest())).json()).eventId).toBe(shotId);
});

it("keeps the game scoped and makes a catalog outage retryable", async () => {
  m.catalog.mockResolvedValueOnce({
    data: [{ id: shotId, event_id: null }],
    error: null,
  });
  expect((await GET(loadRequest())).status).toBe(403);
  m.catalog.mockResolvedValueOnce({
    data: null,
    error: { code: "XX000", message: "private catalog diagnostic" },
  });
  const result = await GET(loadRequest());
  expect(result.status).toBe(503);
  expect((await result.json()).error).toContain("Reload shots");
});
