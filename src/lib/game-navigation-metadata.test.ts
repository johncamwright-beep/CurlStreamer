import { beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./team-hierarchy-service", () => ({
  listTeamHierarchyGames: mocks.list,
}));
import { readGameNavigationMetadata } from "./game-navigation-metadata";
const user = { id: "verified-user" } as User;
beforeEach(() => vi.resetAllMocks());
it("returns only the matching authorized game's allowlisted schedule", async () => {
  mocks.list.mockResolvedValue({
    ok: true,
    value: [
      {
        id: "other",
        scheduled_start: null,
        schedule_timezone: null,
        game_number: 2,
      },
      {
        id: "target",
        scheduled_start: "2026-10-20T22:30:00Z",
        schedule_timezone: "America/Toronto",
        game_number: 3,
        secret: "must not escape",
        organization_id: "private",
      },
    ],
  });
  expect(await readGameNavigationMetadata(user, "target")).toEqual({
    state: "available",
    scheduledStart: "2026-10-20T22:30:00Z",
    timezone: "America/Toronto",
    gameNumber: 3,
  });
});
it.each([
  { ok: false },
  { ok: true, value: [] },
  { ok: true, value: [{ id: "target" }] },
])("reports unavailable for missing or unreadable metadata", async (result) => {
  mocks.list.mockResolvedValue(result);
  expect(await readGameNavigationMetadata(user, "target")).toEqual({
    state: "unavailable",
  });
});
