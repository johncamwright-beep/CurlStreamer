import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { GameConfig } from "@/lib/types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/tokens", () => ({ issueOrganizerToken: vi.fn() }));

import { updateScheduledTeamGame } from "./team-hierarchy-service";

const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const config: GameConfig = {
  eventName: "Club final",
  homeName: "Rocks",
  awayName: "Stones",
  homeColor: "#000000",
  awayColor: "#ffffff",
  scheduledEnds: 8,
  youtubeTitle: "Club final",
  youtubeVisibility: "unlisted",
};
const schedule = {
  seasonId: "22222222-2222-4222-8222-222222222222",
  eventId: null,
  opponentId: null,
  scheduledStart: "2026-09-05T18:00:00.000Z",
  timezone: "America/Toronto",
  gameNumber: null,
};

describe("scheduled game state persistence", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("sends the config snapshot through the atomic schedule RPC", async () => {
    const result = await updateScheduledTeamGame(
      user,
      "33333333-3333-4333-8333-333333333333",
      schedule,
      config,
    );

    expect(result).toEqual({ ok: true, value: null });
    expect(mocks.rpc).toHaveBeenCalledWith("update_scheduled_team_game", {
      p_user_id: user.id,
      p_game_id: "33333333-3333-4333-8333-333333333333",
      p_season_id: schedule.seasonId,
      p_event_id: null,
      p_opponent_id: null,
      p_scheduled_start: schedule.scheduledStart,
      p_game_number: null,
      p_timezone: schedule.timezone,
      p_game_label: "",
      p_config_snapshot: config,
    });
  });

  it("keeps the deployed RPC signature when no snapshot is supplied", async () => {
    await updateScheduledTeamGame(
      user,
      "33333333-3333-4333-8333-333333333333",
      schedule,
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_scheduled_team_game",
      expect.not.objectContaining({ p_config_snapshot: expect.anything() }),
    );
  });

  it("maps a database serialization failure to a useful conflict", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "stale game state" },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      updateScheduledTeamGame(
        user,
        "33333333-3333-4333-8333-333333333333",
        schedule,
        config,
      ),
    ).resolves.toEqual({ ok: false, kind: "conflict" });
  });
});
