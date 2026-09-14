import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  team: vi.fn(),
  events: vi.fn(),
  games: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/team-games", () => ({ loadActiveTeam: mocks.team }));
vi.mock("@/lib/team-hierarchy-service", () => ({
  listEvents: mocks.events,
  listTeamHierarchyGames: mocks.games,
}));
import {
  loadStreamerEvent,
  localStreamerConfigured,
} from "./curlcoach-streamer";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
});
afterEach(() => vi.unstubAllEnvs());
it("refuses shared services before contacting Auth", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://shared.supabase.co");
  expect(localStreamerConfigured()).toBe(false);
  await expect(loadStreamerEvent()).rejects.toThrow("not connected");
  expect(mocks.auth).not.toHaveBeenCalled();
});
it("requires a verified administrator and rejects out-of-scope event IDs", async () => {
  mocks.auth.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  mocks.team.mockResolvedValue({
    kind: "ready",
    team: { organizationId: "org", role: "viewer" },
  });
  await expect(loadStreamerEvent()).rejects.toThrow("administrator");
  expect(mocks.events).not.toHaveBeenCalled();
  mocks.team.mockResolvedValue({
    kind: "ready",
    team: { organizationId: "org", role: "owner" },
  });
  mocks.events.mockResolvedValue({
    ok: true,
    value: [{ id: "00000000-0000-4000-8000-000000000001", name: "Our event" }],
  });
  mocks.games.mockResolvedValue({ ok: true, value: [] });
  await expect(
    loadStreamerEvent("00000000-0000-4000-8000-000000000002"),
  ).rejects.toThrow("organization");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("loads only the selected event and projects completed scoreboard data without writing", async () => {
  const eventId = "00000000-0000-4000-8000-000000000001",
    id = "00000000-0000-4000-8000-000000000003";
  mocks.auth.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  mocks.team.mockResolvedValue({
    kind: "ready",
    team: { organizationId: "org", role: "owner" },
  });
  mocks.events.mockResolvedValue({
    ok: true,
    value: [{ id: eventId, name: "Shorty" }],
  });
  mocks.games.mockResolvedValue({
    ok: true,
    value: [
      {
        id,
        event_id: eventId,
        game_number: 7,
        game_label: null,
        game_status: "completed",
        config: {
          eventName: "Shorty",
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
  const result = await loadStreamerEvent(eventId);
  expect(result.event.games[0].ends).toEqual([
    { end: 1, us: 0, them: 2, hammer: true },
  ]);
  expect(result.event.games[0].state.organizationId).toBe("org");
  expect(mocks.rpc).not.toHaveBeenCalled();
  const listing = await mocks.games();
  listing.value[0].completion_result = { outcome: "no_result", ends: [] };
  mocks.games.mockResolvedValue(listing);
  mocks.rpc.mockResolvedValue({ data: [{ outcome: "closed" }], error: null });
  expect(
    (await loadStreamerEvent(eventId)).event.games[0].scoreboardAvailable,
  ).toBe(false);
});
