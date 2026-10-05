import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleEvent } from "@/lib/curlcoach/event";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  source: vi.fn(),
  load: vi.fn(),
  generate: vi.fn(),
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
