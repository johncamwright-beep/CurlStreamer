import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAccountContext: vi.fn(),
  loadTeamHierarchyData: vi.fn(),
  updateScheduledTeamGame: vi.fn(),
  createScheduledTeamGame: vi.fn(),
  listOpponents: vi.fn(),
  provisionScheduledYouTubeBroadcast: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/team-hierarchy-data", () => ({
  loadTeamHierarchyData: mocks.loadTeamHierarchyData,
}));
vi.mock("@/lib/auth/account", () => ({
  getAccountContext: mocks.getAccountContext,
}));
vi.mock("@/lib/team-hierarchy-service", () => ({
  archiveEvent: vi.fn(),
  archiveOpponent: vi.fn(),
  archiveSeason: vi.fn(),
  createEvent: vi.fn(),
  createScheduledTeamGame: mocks.createScheduledTeamGame,
  createSeason: vi.fn(),
  findOrCreateOpponent: vi.fn(),
  listOpponents: mocks.listOpponents,
  restoreOpponent: vi.fn(),
  setCurrentSeason: vi.fn(),
  updateEvent: vi.fn(),
  updateScheduledTeamGame: mocks.updateScheduledTeamGame,
}));
vi.mock("@/lib/providers/scheduled-youtube", () => ({
  provisionScheduledYouTubeBroadcast: mocks.provisionScheduledYouTubeBroadcast,
}));

import { POST } from "./route";

const seasonId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const gameId = "33333333-3333-4333-8333-333333333333";
const config = {
  eventName: "Fall final",
  homeName: "Rocks",
  awayName: "Opponent TBD",
  homeColor: "#000000",
  awayColor: "#ffffff",
  scheduledEnds: 8,
  youtubeTitle: "Fall final",
  youtubeVisibility: "unlisted",
};

function request(
  operation: "createGame" | "updateGame",
  scheduledDate: string,
  scheduledTime: string,
  gameConfig: Record<string, unknown> = config,
) {
  return new Request("http://localhost/api/team-schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation,
      ...(operation === "updateGame" ? { gameId } : {}),
      seasonId,
      eventId,
      scheduledDate,
      scheduledTime,
      timezone: "America/Toronto",
      gameNumber: 1,
      config: gameConfig,
    }),
  });
}

describe("team schedule timezone boundary", () => {
  it("explains how to recover from a duplicate game number", async () => {
    mocks.createScheduledTeamGame.mockResolvedValue({
      ok: false,
      kind: "gameNumberConflict",
    });
    const response = await POST(request("createGame", "2026-10-20", "18:30"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain(
      "leave the optional game number blank",
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          email_confirmed_at: "now",
        },
      },
    });
    mocks.getAccountContext.mockResolvedValue({
      ok: true,
      account: {
        profile: { status: "active" },
        membership: {
          role: "owner",
          organization_id: "team",
          teamName: "Rocks",
        },
      },
    });
    mocks.loadTeamHierarchyData.mockResolvedValue({
      ok: true,
      teamName: "Rocks",
      role: "owner",
      seasons: [
        {
          id: seasonId,
          name: "2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          status: "active",
        },
      ],
      events: [
        {
          id: eventId,
          seasonId,
          name: "Fall final",
          eventType: "tournament",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          location: null,
          timezone: "America/Toronto",
          archivedAt: null,
        },
      ],
      games: [
        {
          id: gameId,
          seasonId,
          eventId,
          opponentId: null,
          scheduledStart: "2026-11-01T06:30:00.000Z",
          timezone: "America/Toronto",
          gameNumber: 1,
          gameLabel: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "active",
          config,
        },
      ],
    });
    mocks.updateScheduledTeamGame.mockResolvedValue({ ok: true, value: null });
    mocks.createScheduledTeamGame.mockResolvedValue({
      ok: true,
      value: { game: { id: gameId } },
    });
  });

  it.each(["owner", "team_admin", "game_operator"])(
    "returns a scheduled game for %s without independent bearer access",
    async (role) => {
      const account = await mocks.getAccountContext();
      account.account.membership.role = role;
      const response = await POST(request("createGame", "2026-10-20", "18:30"));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ game: { id: gameId } });
    },
  );

  it("preserves the later fall-back instant on an unchanged edit", async () => {
    const response = await POST(request("updateGame", "2026-11-01", "01:30"));

    expect(response.status).toBe(200);
    expect(mocks.updateScheduledTeamGame).toHaveBeenCalledWith(
      expect.objectContaining({ id: "44444444-4444-4444-8444-444444444444" }),
      gameId,
      expect.objectContaining({
        scheduledStart: "2026-11-01T06:30:00.000Z",
        timezone: "America/Toronto",
      }),
      expect.anything(),
    );
  });

  it("uses the chosen game timezone even when the event was saved in UTC", async () => {
    const hierarchy = await mocks.loadTeamHierarchyData();
    hierarchy.events[0].timezone = "UTC";
    const response = await POST(request("createGame", "2026-07-15", "19:30"));

    expect(response.status).toBe(201);
    expect(mocks.createScheduledTeamGame).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scheduledStart: "2026-07-15T23:30:00.000Z",
        timezone: "America/Toronto",
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.provisionScheduledYouTubeBroadcast).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent spring-forward wall time", async () => {
    const response = await POST(request("updateGame", "2026-03-08", "02:30"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a valid local date and time for the event timezone.",
    });
    expect(mocks.updateScheduledTeamGame).not.toHaveBeenCalled();
  });

  it("saves a shared YouTube link without enabling a team broadcast", async () => {
    const sharedConfig = {
      ...config,
      sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
    };
    const response = await POST(
      request("createGame", "2026-10-20", "18:30", sharedConfig),
    );

    expect(response.status).toBe(201);
    expect(mocks.createScheduledTeamGame).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
      }),
      expect.anything(),
    );
  });

  it("rejects combining a shared link with team YouTube provisioning", async () => {
    const response = await POST(
      request("createGame", "2026-10-20", "18:30", {
        ...config,
        youtubeEnabled: true,
        sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createScheduledTeamGame).not.toHaveBeenCalled();
  });

  it("does not update a prior team broadcast after an edit switches to a shared link", async () => {
    const hierarchy = await mocks.loadTeamHierarchyData();
    hierarchy.games[0].config = { ...config, youtubeEnabled: true };
    hierarchy.games[0].scheduledYouTubeWatchUrl =
      "https://www.youtube.com/watch?v=abcdefghijk";
    const response = await POST(
      request("updateGame", "2026-11-01", "01:30", {
        ...config,
        sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateScheduledTeamGame).toHaveBeenCalledWith(
      expect.anything(),
      gameId,
      expect.anything(),
      expect.objectContaining({
        youtubeEnabled: undefined,
        sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
      }),
    );
    expect(mocks.provisionScheduledYouTubeBroadcast).not.toHaveBeenCalled();
  });
});
