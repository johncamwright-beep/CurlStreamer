import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAccountContext: vi.fn(),
  loadTeamHierarchyData: vi.fn(),
  updateScheduledTeamGame: vi.fn(),
  createScheduledTeamGame: vi.fn(),
  listOpponents: vi.fn(),
  listSeasons: vi.fn(),
  listOpponentSeasons: vi.fn(),
  saveOpponentDetails: vi.fn(),
  provisionScheduledYouTubeBroadcast: vi.fn(),
  refreshScheduledYouTubeThumbnail: vi.fn(),
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
vi.mock("@/lib/team-hierarchy-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-hierarchy-service")>()),
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
  listSeasons: mocks.listSeasons,
  listOpponentSeasons: mocks.listOpponentSeasons,
  saveOpponentDetails: mocks.saveOpponentDetails,
}));
vi.mock("@/lib/providers/scheduled-youtube", () => ({
  provisionScheduledYouTubeBroadcast: mocks.provisionScheduledYouTubeBroadcast,
  refreshScheduledYouTubeThumbnail: mocks.refreshScheduledYouTubeThumbnail,
}));

import { GET, POST } from "./route";

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

describe("opponent details authorization and optimistic input", () => {
  const input = {
    displayName: "Corrected",
    expectedDisplayName: "Old",
    seasonId,
    level: null,
    roster: {},
    expectedRevision: 0,
  };
  function detailsRequest(body: unknown) {
    return new Request("http://localhost/api/team-schedule", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: gameId, email_confirmed_at: "now" } },
    });
    mocks.getAccountContext.mockResolvedValue({
      ok: true,
      account: { membership: { role: "owner" } },
    });
    mocks.saveOpponentDetails.mockResolvedValue({
      ok: true,
      value: {
        opponent: { id: eventId, displayName: "Corrected" },
        profile: { revision: 1 },
      },
    });
  });
  it("saves name, level and roster once using the authenticated actor", async () => {
    const response = await POST(
      detailsRequest({
        operation: "updateOpponentDetails",
        opponentId: eventId,
        input,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.saveOpponentDetails).toHaveBeenCalledOnce();
    expect(mocks.saveOpponentDetails).toHaveBeenCalledWith(
      expect.objectContaining({ id: gameId }),
      expect.objectContaining({
        displayName: "Corrected",
        seasonId,
        expectedRevision: 0,
        roster: expect.objectContaining({ lead: "", coach: "" }),
      }),
      { opponentId: eventId, expectedDisplayName: "Old" },
    );
  });
  it.each(["viewer", "game_operator"])(
    "denies %s full detail writes",
    async (role) => {
      mocks.getAccountContext.mockResolvedValue({
        ok: true,
        account: { membership: { role } },
      });
      expect(
        (
          await POST(
            detailsRequest({
              operation: "updateOpponentDetails",
              opponentId: eventId,
              input,
            }),
          )
        ).status,
      ).toBe(403);
      expect(mocks.saveOpponentDetails).not.toHaveBeenCalled();
    },
  );
  it("requires a name comparison and clean roster input", async () => {
    const missingName: Partial<typeof input> = { ...input };
    delete missingName.expectedDisplayName;
    expect(
      (
        await POST(
          detailsRequest({
            operation: "updateOpponentDetails",
            opponentId: eventId,
            input: missingName,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          detailsRequest({
            operation: "updateOpponentDetails",
            opponentId: eventId,
            input: { ...input, roster: { lead: 23 } },
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.saveOpponentDetails).not.toHaveBeenCalled();
  });
  it("returns useful duplicate conflicts", async () => {
    mocks.saveOpponentDetails.mockResolvedValue({
      ok: false,
      kind: "opponentNameConflict",
    });
    const response = await POST(
      detailsRequest({
        operation: "updateOpponentDetails",
        opponentId: eventId,
        input,
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("already exists");
  });
  it("reads the current identity and selected season without leaking unrelated data", async () => {
    mocks.listOpponents.mockResolvedValue({
      ok: true,
      value: [{ id: eventId, display_name: "Current name" }],
    });
    mocks.listSeasons.mockResolvedValue({
      ok: true,
      value: [{ id: seasonId, status: "active" }],
    });
    mocks.listOpponentSeasons.mockResolvedValue({
      ok: true,
      value: [{ opponent_id: eventId, season_id: seasonId, revision: 7 }],
    });
    const response = await GET(
      new Request(
        `http://localhost/api/team-schedule?opponentId=${eventId}&seasonId=${seasonId}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      opponent: { id: eventId, displayName: "Current name" },
      profile: { opponent_id: eventId, season_id: seasonId, revision: 7 },
    });
    mocks.listOpponents.mockResolvedValue({ ok: true, value: [] });
    expect(
      (
        await GET(
          new Request(
            `http://localhost/api/team-schedule?opponentId=${eventId}&seasonId=${seasonId}`,
          ),
        )
      ).status,
    ).toBe(403);
  });
});

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

  it.each(["unlisted", "public", "private"])(
    "reserves a watch page using the saved %s visibility without starting live",
    async (visibility) => {
      mocks.provisionScheduledYouTubeBroadcast.mockResolvedValue({
        status: "ready",
        watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      });
      const response = await POST(
        request("createGame", "2026-10-20", "18:30", {
          ...config,
          youtubeEnabled: true,
          youtubeVisibility: visibility,
        }),
      );
      expect(response.status).toBe(201);
      expect(mocks.createScheduledTeamGame).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ youtubeVisibility: visibility }),
        expect.anything(),
      );
      expect(mocks.provisionScheduledYouTubeBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ id: "44444444-4444-4444-8444-444444444444" }),
        expect.objectContaining({
          gameId: expect.any(String),
          visibility,
          scheduledStart: "2026-10-20T22:30:00.000Z",
        }),
      );
    },
  );

  it("preserves Public when an upcoming game is edited", async () => {
    const hierarchy = await mocks.loadTeamHierarchyData();
    hierarchy.games[0].config = { ...config, youtubeEnabled: true };
    hierarchy.games[0].scheduledYouTubeWatchUrl =
      "https://www.youtube.com/watch?v=abcdefghijk";
    mocks.provisionScheduledYouTubeBroadcast.mockResolvedValue({
      status: "ready",
    });
    const response = await POST(
      request("updateGame", "2026-11-01", "01:30", {
        ...config,
        youtubeEnabled: true,
        youtubeVisibility: "public",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.updateScheduledTeamGame).toHaveBeenCalledWith(
      expect.anything(),
      gameId,
      expect.anything(),
      expect.objectContaining({ youtubeVisibility: "public" }),
    );
    expect(mocks.provisionScheduledYouTubeBroadcast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gameId, visibility: "public" }),
    );
  });

  it("uses saved Public visibility when retrying watch-page preparation", async () => {
    const hierarchy = await mocks.loadTeamHierarchyData();
    hierarchy.games[0].config = {
      ...config,
      youtubeEnabled: true,
      youtubeVisibility: "public",
    };
    mocks.provisionScheduledYouTubeBroadcast.mockResolvedValue({
      status: "ready",
    });
    const response = await POST(
      new Request("http://localhost/api/team-schedule", {
        method: "POST",
        body: JSON.stringify({ operation: "retryYouTube", gameId }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.provisionScheduledYouTubeBroadcast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gameId, visibility: "public" }),
    );
  });

  it("updates existing artwork without editing the game or reserving a new video", async () => {
    const hierarchy = await mocks.loadTeamHierarchyData();
    hierarchy.games[0].config = { ...config, youtubeEnabled: true };
    hierarchy.games[0].scheduledYouTubeWatchUrl =
      "https://www.youtube.com/watch?v=abcdefghijk";
    mocks.refreshScheduledYouTubeThumbnail.mockResolvedValue(undefined);
    const response = await POST(
      new Request("http://localhost/api/team-schedule", {
        method: "POST",
        body: JSON.stringify({ operation: "refreshYouTubeThumbnail", gameId }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.refreshScheduledYouTubeThumbnail).toHaveBeenCalledWith(
      expect.anything(),
      gameId,
      "abcdefghijk",
      expect.objectContaining({ homeName: "Rocks" }),
    );
    expect(mocks.updateScheduledTeamGame).not.toHaveBeenCalled();
    expect(mocks.provisionScheduledYouTubeBroadcast).not.toHaveBeenCalled();
  });

  it.each(["viewer", "game_operator"])(
    "rejects %s thumbnail mutations before reading team data",
    async (role) => {
      mocks.getAccountContext.mockResolvedValue({
        ok: true,
        account: { membership: { role } },
      });
      const response = await POST(
        new Request("http://localhost/api/team-schedule", {
          method: "POST",
          body: JSON.stringify({
            operation: "refreshYouTubeThumbnail",
            gameId,
          }),
        }),
      );
      expect(response.status).toBe(403);
      expect(mocks.refreshScheduledYouTubeThumbnail).not.toHaveBeenCalled();
      expect(mocks.loadTeamHierarchyData).not.toHaveBeenCalled();
    },
  );

  it("rejects external shared video artwork without calling Google", async () => {
    const hierarchy = await mocks.loadTeamHierarchyData();
    hierarchy.games[0].config = {
      ...config,
      youtubeEnabled: true,
      sharedYoutubeWatchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    };
    hierarchy.games[0].scheduledYouTubeWatchUrl =
      "https://www.youtube.com/watch?v=abcdefghijk";
    const response = await POST(
      new Request("http://localhost/api/team-schedule", {
        method: "POST",
        body: JSON.stringify({ operation: "refreshYouTubeThumbnail", gameId }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.refreshScheduledYouTubeThumbnail).not.toHaveBeenCalled();
  });

  it("rejects unsupported visibility before a game or provider is created", async () => {
    const response = await POST(
      request("createGame", "2026-10-20", "18:30", {
        ...config,
        youtubeEnabled: true,
        youtubeVisibility: "listed",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createScheduledTeamGame).not.toHaveBeenCalled();
    expect(mocks.provisionScheduledYouTubeBroadcast).not.toHaveBeenCalled();
  });

  it("explains a reserved visibility conflict without calling YouTube", async () => {
    mocks.updateScheduledTeamGame.mockResolvedValue({
      ok: false,
      kind: "youtubeVisibilityLocked",
    });
    const response = await POST(
      request("updateGame", "2026-10-20", "18:30", {
        ...config,
        youtubeEnabled: true,
        youtubeVisibility: "public",
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain(
      "fixed once its watch page is reserved",
    );
    expect(mocks.provisionScheduledYouTubeBroadcast).not.toHaveBeenCalled();
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
