vi.mock("./curlcoach-video", () => ({ loadCoachBroadcastReviews: m.videos }));
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  auth: vi.fn(),
  settings: vi.fn(),
  events: vi.fn(),
  seasons: vi.fn(),
  games: vi.fn(),
  rpc: vi.fn(),
  videos: vi.fn(),
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: m.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  readTeamSettings: m.settings,
}));
vi.mock("@/lib/team-hierarchy-service", () => ({
  listEvents: m.events,
  listSeasons: m.seasons,
  listTeamHierarchyGames: m.games,
}));
import { loadProductionStreamerEvent } from "./curlcoach-production-streamer";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
const eid = "00000000-0000-4000-8000-000000000001",
  gid = "00000000-0000-4000-8000-000000000002";
const account = {
  userId: "coach",
  organizationId: "org",
  user: { id: "coach" },
} as CoachAccount;
beforeEach(() => {
  vi.clearAllMocks();
  m.videos.mockResolvedValue({});
  m.account.mockResolvedValue({
    userId: "coach",
    organizationId: "org",
    user: account.user,
  });
  m.auth.mockResolvedValue({ data: { user: { id: "coach" } }, error: null });
  m.settings.mockResolvedValue({
    settings: {
      roster: { lead: "Real Player", second: "", third: "", fourth: "" },
    },
  });
  m.seasons.mockResolvedValue({ ok: true, value: [] });
  m.events.mockResolvedValue({
    ok: true,
    value: [{ id: eid, name: "Our event" }],
  });
  m.games.mockResolvedValue({
    ok: true,
    value: [
      {
        id: gid,
        event_id: eid,
        game_number: 1,
        game_label: null,
        game_status: "completed",
        config: {
          eventName: "Our event",
          homeName: "Us",
          awayName: "Them",
          scheduledEnds: 8,
          initialHammer: "home",
        },
        completion_result: {
          ends: [{ end: 1, team: "away", points: 2, blank: false }],
        },
      },
    ],
  });
});
it("uses the route's request-local account without repeating authentication", async () => {
  await loadProductionStreamerEvent(eid, undefined, undefined, account);
  expect(m.account).not.toHaveBeenCalled();
  expect(m.auth).not.toHaveBeenCalled();
  expect(m.events).toHaveBeenCalledWith(account.user);
});
it("denies before reading shared games or roster", async () => {
  m.account.mockResolvedValue(null);
  await expect(loadProductionStreamerEvent()).rejects.toThrow("access");
  expect(m.games).not.toHaveBeenCalled();
  expect(m.videos).not.toHaveBeenCalled();
  expect(m.settings).not.toHaveBeenCalled();
});
it("links completed scoreboard and real roster without writing shared state", async () => {
  const result = await loadProductionStreamerEvent(eid);
  expect(result.event.games[0].ends).toEqual([
    { end: 1, us: 0, them: 2, hammer: true, hammerBefore: true },
  ]);
  expect(result.event.games[0].state.roster).toEqual([
    { id: expect.any(String), name: "Real Player", position: "Lead" },
  ]);
  expect(result.event.games[0].state.roster?.[0].id).not.toBe("lead");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("refuses another event and supports eventless games", async () => {
  await expect(loadProductionStreamerEvent("another-event")).rejects.toThrow(
    "organization",
  );
  const rows = await m.games();
  rows.value[0].event_id = null;
  m.games.mockResolvedValue(rows);
  const result = await loadProductionStreamerEvent("standalone");
  expect(result.event.games[0].id).toBe(gid);
});

it("a shot save reads only the selected authorized game's scoreboard", async () => {
  const { value } = await m.games();
  const first = { ...value[0], game_status: "active", completion_result: null };
  const second = { ...first, id: "00000000-0000-4000-8000-000000000009" };
  m.games.mockResolvedValue({ ok: true, value: [first, second] });
  m.rpc.mockResolvedValue({ data: [], error: null });
  const result = await loadProductionStreamerEvent(eid, gid);
  expect(m.videos).not.toHaveBeenCalled();
  expect(result.event.games.map((g) => g.id)).toEqual([gid]);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("read_game_state", {
    p_game_id: gid,
  });
  m.rpc.mockClear();
  expect(
    (
      await loadProductionStreamerEvent(
        eid,
        "00000000-0000-4000-8000-000000000088",
      )
    ).event.games,
  ).toEqual([]);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("opens the current tournament instead of an old empty event or distant upcoming game", async () => {
  const old = "00000000-0000-4000-8000-000000000099";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T16:00:00Z"));
  try {
    m.events.mockResolvedValue({
      ok: true,
      value: [
        {
          id: old,
          name: "Old",
          start_date: "2026-01-01",
          end_date: "2026-01-02",
        },
        {
          id: eid,
          name: "Current",
          start_date: "2026-09-17",
          end_date: "2026-09-20",
          timezone: "America/Toronto",
        },
      ],
    });
    const result = await loadProductionStreamerEvent();
    expect(result.event.id).toBe(eid);
    const explicit = await loadProductionStreamerEvent(old);
    expect(explicit.event.id).toBe(old);
  } finally {
    vi.useRealTimers();
  }
});

it("season aggregation excludes other seasons, deleted games and unauthorized season IDs", async () => {
  const firstSeason = "00000000-0000-4000-8000-000000000050";
  const secondSeason = "00000000-0000-4000-8000-000000000051";
  const otherEvent = "00000000-0000-4000-8000-000000000052";
  m.seasons.mockResolvedValue({
    ok: true,
    value: [
      { id: firstSeason, name: "2026–27" },
      { id: secondSeason, name: "2025–26" },
    ],
  });
  m.events.mockResolvedValue({
    ok: true,
    value: [
      { id: eid, name: "Current", season_id: firstSeason },
      { id: otherEvent, name: "Past", season_id: secondSeason },
    ],
  });
  const { value } = await m.games();
  m.games.mockResolvedValue({
    ok: true,
    value: [
      { ...value[0], season_id: firstSeason },
      {
        ...value[0],
        id: otherEvent,
        event_id: otherEvent,
        season_id: secondSeason,
      },
      {
        ...value[0],
        id: "00000000-0000-4000-8000-000000000053",
        season_id: firstSeason,
        game_status: "deleted",
      },
      {
        ...value[0],
        id: "00000000-0000-4000-8000-000000000054",
        event_id: null,
        season_id: firstSeason,
      },
    ],
  });
  const result = await loadProductionStreamerEvent(
    undefined,
    undefined,
    firstSeason,
  );
  expect(result.event.seasonId).toBe(firstSeason);
  expect(result.event.games.map((g) => g.id)).toEqual([
    gid,
    "00000000-0000-4000-8000-000000000054",
  ]);
  expect(result.event.games[0].eventId).toBe(eid);
  expect(result.event.games[1].eventId).toBe("standalone");
  await expect(
    loadProductionStreamerEvent(
      undefined,
      undefined,
      "00000000-0000-4000-8000-000000000099",
    ),
  ).rejects.toThrow("Season unavailable");
});

it("loads timing only for authorized selected games", async () => {
  m.videos.mockResolvedValue({
    [gid]: {
      url: "https://youtu.be/abcdefghijk",
      startedAt: "2026-09-19T12:00:00Z",
    },
  });
  const result = await loadProductionStreamerEvent(eid);
  expect(m.videos).toHaveBeenCalledWith("org", [gid]);
  expect(result.event.games[0].broadcastReview?.startedAt).toBe(
    "2026-09-19T12:00:00Z",
  );
});

it("bounds concurrent active-score reads while preserving game order", async () => {
  const { value } = await m.games();
  const active = Array.from({ length: 9 }, (_, index) => ({
    ...value[0],
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    game_number: index + 1,
    game_status: "active",
    completion_result: null,
  }));
  m.games.mockResolvedValue({ ok: true, value: active });
  let inFlight = 0;
  let peak = 0;
  m.rpc.mockImplementation(async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight--;
    return { data: [], error: null };
  });
  const workspace = await loadProductionStreamerEvent(eid);
  expect(workspace.event.games.map((game) => game.id)).toEqual(
    active.map((game) => game.id),
  );
  expect(peak).toBe(4);
});

it("reads saved line scores when the scheduling list omits completion_result", async () => {
  const { value } = await m.games();
  const { completion_result: _omitted, ...row } = value[0];
  m.games.mockResolvedValue({ ok: true, value: [row] });
  m.rpc.mockImplementation(async (name) =>
    name === "read_game_state"
      ? { data: [{ outcome: "closed", state: null }], error: null }
      : {
          data: {
            result: {
              outcome: "home_win",
              ends: [
                { end: 1, team: "home", points: 2, blank: false },
                { end: 2, team: null, points: 0, blank: true },
                { end: 3, team: "away", points: 1, blank: false },
              ],
            },
          },
          error: null,
        },
  );
  const result = await loadProductionStreamerEvent(eid);
  expect(result.event.games[0].scoreboardAvailable).toBe(true);
  expect(result.event.games[0].ends).toEqual([
    { end: 1, us: 2, them: 0, hammer: false, hammerBefore: true },
    { end: 2, us: 0, them: 0, hammer: false, hammerBefore: false },
    { end: 3, us: 0, them: 1, hammer: true, hammerBefore: false },
  ]);
  expect(m.rpc).toHaveBeenCalledWith("read_game_completion_summary", {
    p_game_id: gid,
  });
});

it.each([null, { result: { outcome: "no_result", ends: [] } }])(
  "does not invent a score for a closed game without a result",
  async (completion) => {
    const { value } = await m.games();
    m.games.mockResolvedValue({
      ok: true,
      value: [{ ...value[0], completion_result: null }],
    });
    m.rpc.mockImplementation(async (name) => ({
      data:
        name === "read_game_state"
          ? [{ outcome: "closed", state: null }]
          : completion,
      error: null,
    }));
    const result = await loadProductionStreamerEvent(eid);
    expect(result.event.games[0].scoreboardAvailable).toBe(false);
    expect(result.event.games[0].ends).toEqual([]);
  },
);
