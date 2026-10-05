import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleEvent } from "@/lib/curlcoach/event";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  source: vi.fn(),
  load: vi.fn(),
  generate: vi.fn(),
  events: vi.fn(),
  games: vi.fn(),
}));
vi.mock("@/lib/team-hierarchy-service", () => ({
  listEvents: m.events,
  listTeamHierarchyGames: m.games,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
vi.mock("./curlcoach-production-streamer", () => ({
  loadProductionStreamerEvent: m.source,
}));
vi.mock("./curlcoach-store", () => ({ loadCoachState: m.load }));
vi.mock("./shot-tracker-ai", () => ({
  reportAIConfig: () => ({ model: "test" }),
  generateShotTrackerNarrative: m.generate,
}));
import {
  generateEventReports,
  listReportEvents,
  reportFingerprint,
} from "./shot-tracker-reports";
const account = { userId: "coach-one", organizationId: "org" } as CoachAccount;
function event() {
  const e = sampleEvent("shorty-example");
  e.organizationId = "org";
  e.games.forEach((g) => (g.status = "completed"));
  return e;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHOT_TRACKER_AI_MODEL", "test");
  m.load.mockImplementation((_s, initial) => initial);
  m.rpc.mockImplementation(async (name) => ({
    error: null,
    data: name === "claim_shot_tracker_report" ? { status: "claimed" } : true,
  }));
  m.generate.mockResolvedValue({
    summary: { text: "Our team works together.", evidence: ["overall"] },
    strengths: [],
    priorities: [],
    practice: [],
    review: [],
  });
});
afterEach(() => vi.unstubAllEnvs());
it("lists completed and unfinished events without generating or exposing report packets", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  m.events.mockResolvedValue({
    ok: true,
    value: [
      { id, name: "Finished", start_date: "2026-10-01" },
      { id: other, name: "Upcoming", start_date: "2026-11-01" },
    ],
  });
  m.games.mockResolvedValue({
    ok: true,
    value: [
      { event_id: id, game_status: "completed" },
      { event_id: id, game_status: "deleted" },
      { event_id: other, game_status: "scheduled" },
    ],
  });
  m.rpc.mockImplementation(async (_name, args) => ({
    error: null,
    data:
      args.p_event === id
        ? [
            {
              status: "ready",
              updated_at: new Date().toISOString(),
              packet: { private: "content" },
            },
          ]
        : [],
  }));
  const result = await listReportEvents(account);
  expect(result.map((e) => [e.name, e.complete, e.saved])).toEqual([
    ["Upcoming", false, 0],
    ["Finished", true, 1],
  ]);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(m.generate).not.toHaveBeenCalled();
  for (const [name, args] of m.rpc.mock.calls) {
    expect(name).toBe("read_shot_tracker_reports");
    expect(args).toMatchObject({
      p_actor: account.userId,
      p_org: account.organizationId,
    });
  }
});
it("invalidates cached evidence when scores, roster, status or grades change", () => {
  const e = event(),
    hash = reportFingerprint(e, "team");
  for (const mutate of [
    (x: typeof e) => x.games[0].ends[0].us++,
    (x: typeof e) => (x.games[0].state.events[0].shot!.grade = 0),
    (x: typeof e) => (x.games[0].status = "active"),
    (x: typeof e) =>
      (x.games[0].state.roster = [{ id: "changed", name: "Changed" }]),
  ]) {
    const changed = structuredClone(e);
    mutate(changed);
    expect(reportFingerprint(changed, "team")).not.toBe(hash);
  }
  expect(reportFingerprint(e, "coach")).not.toBe(hash);
});
it("returns cached versions without a provider request", async () => {
  m.rpc.mockResolvedValue({
    error: null,
    data: { status: "ready", packet: { reports: [] } },
  });
  expect(await generateEventReports(account, event(), "team")).toEqual({
    reports: [],
  });
  expect(m.generate).not.toHaveBeenCalled();
});
it.each(["locked", "season_limit"])(
  "rejects %s before making any provider call",
  async (status) => {
    m.rpc.mockResolvedValue({ error: null, data: { status } });
    await expect(
      generateEventReports(account, event(), "team"),
    ).rejects.toMatchObject({ status: 429 });
    expect(m.generate).not.toHaveBeenCalled();
  },
);
it("passes the actor scope into storage and rejects duplicate claims", async () => {
  m.rpc.mockResolvedValue({ error: null, data: { status: "processing" } });
  await expect(
    generateEventReports(account, event(), "team"),
  ).rejects.toMatchObject({ status: 429 });
  expect(m.rpc.mock.calls[0][1]).toMatchObject({
    p_actor: "coach-one",
    p_org: "org",
    p_audience: "team",
  });
  expect(m.generate).not.toHaveBeenCalled();
});
it("never saves a report against changed source data", async () => {
  const e = event();
  const changed = structuredClone(e);
  changed.games[0].ends[0].us++;
  m.source.mockResolvedValue({ event: changed });
  await expect(generateEventReports(account, e, "team")).rejects.toMatchObject({
    status: 409,
  });
  expect(m.rpc.mock.calls.at(-1)?.[1].p_packet).toBeNull();
});
it("saves complete team-only evidence and makes separate calls for each player", async () => {
  const e = event();
  m.source.mockImplementation(async () => ({ event: structuredClone(e) }));
  const packet = await generateEventReports(account, e, "team");
  expect(packet.reports).toHaveLength(1);
  expect(
    packet.reports[0].evidence.some((x) => x.id.startsWith("player-")),
  ).toBe(false);
  m.generate.mockClear();
  const individual = await generateEventReports(account, e, "players");
  expect(individual.reports.length).toBeGreaterThan(1);
  expect(m.generate).toHaveBeenCalledTimes(individual.reports.length);
});
