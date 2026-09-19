import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  auth: vi.fn(),
  settings: vi.fn(),
  events: vi.fn(),
  games: vi.fn(),
  rpc: vi.fn(),
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
  listTeamHierarchyGames: m.games,
}));
import { loadProductionStreamerEvent } from "./curlcoach-production-streamer";
const eid = "00000000-0000-4000-8000-000000000001",
  gid = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.clearAllMocks();
  m.account.mockResolvedValue({ userId: "coach", organizationId: "org" });
  m.auth.mockResolvedValue({ data: { user: { id: "coach" } }, error: null });
  m.settings.mockResolvedValue({
    settings: {
      roster: { lead: "Real Player", second: "", third: "", fourth: "" },
    },
  });
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
it("denies before reading shared games or roster", async () => {
  m.account.mockResolvedValue(null);
  await expect(loadProductionStreamerEvent()).rejects.toThrow("access");
  expect(m.games).not.toHaveBeenCalled();
  expect(m.settings).not.toHaveBeenCalled();
});
it("links completed scoreboard and real roster without writing shared state", async () => {
  const result = await loadProductionStreamerEvent(eid);
  expect(result.event.games[0].ends).toEqual([
    { end: 1, us: 0, them: 2, hammer: true },
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
