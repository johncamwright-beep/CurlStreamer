import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { GameConfig, GameState } from "@/lib/types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), issueToken: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/tokens", () => ({ issueOrganizerToken: mocks.issueToken }));

import {
  createEvent,
  createScheduledTeamGame,
  updateEvent,
  updateScheduledTeamGame,
  saveOpponentDetails,
} from "./team-hierarchy-service";

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
    mocks.issueToken.mockReset();
  });

  it("creates a scheduled game without issuing independent organizer access", async () => {
    const state = {
      id: "33333333-3333-4333-8333-333333333333",
      config,
    } as GameState;
    const result = await createScheduledTeamGame(user, schedule, config, state);
    expect(result).toEqual({ ok: true, value: { game: state } });
    expect(mocks.issueToken).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_scheduled_team_game",
      expect.objectContaining({ p_user_id: user.id, p_game_id: state.id }),
    );
  });

  it("identifies an occupied event game number without mislabelling other conflicts", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "games_event_game_number_unique"',
      },
    });
    await expect(
      updateScheduledTeamGame(
        user,
        "33333333-3333-4333-8333-333333333333",
        schedule,
        config,
      ),
    ).resolves.toEqual({ ok: false, kind: "gameNumberConflict" });
    mocks.rpc.mockResolvedValueOnce({
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "other_unique"',
      },
    });
    await expect(
      updateScheduledTeamGame(
        user,
        "33333333-3333-4333-8333-333333333333",
        schedule,
        config,
      ),
    ).resolves.toEqual({ ok: false, kind: "conflict" });
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

describe("atomic opponent details persistence", () => {
  const input = {
    displayName: "  Corrected team  ",
    seasonId: schedule.seasonId,
    level: "U18" as const,
    roster: {
      lead: "Lead",
      second: "",
      third: "",
      fourth: "",
      alternate: "",
      coach: "",
    },
    expectedRevision: 2,
  };
  const existing = { opponentId: user.id, expectedDisplayName: "Old team" };
  beforeEach(() => mocks.rpc.mockReset());
  it("saves the name and complete season profile through one RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          opponent_id: user.id,
          display_name: "Corrected team",
          season_id: schedule.seasonId,
          level: "U18",
          roster: input.roster,
          revision: 3,
        },
      ],
      error: null,
    });
    const result = await saveOpponentDetails(user, input, existing);
    expect(result).toMatchObject({
      ok: true,
      value: {
        opponent: { id: user.id, displayName: "Corrected team" },
        profile: { revision: 3 },
      },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_opponent_details", {
      p_user_id: user.id,
      p_opponent_id: user.id,
      p_create: false,
      p_display_name: "Corrected team",
      p_expected_display_name: "Old team",
      p_season_id: input.seasonId,
      p_level: input.level,
      p_roster: input.roster,
      p_expected_revision: 2,
    });
  });
  it("rejects invalid roster values and creation revisions before RPC", async () => {
    expect(
      await saveOpponentDetails(
        user,
        { ...input, roster: { ...input.roster, lead: "x".repeat(101) } },
        existing,
      ),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(await saveOpponentDetails(user, input)).toMatchObject({
      ok: false,
      kind: "validation",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", "authorization"],
    ["40001", "conflict"],
    ["23505", "opponentNameConflict"],
  ])("maps %s without exposing database details", async (code, kind) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await saveOpponentDetails(user, input, existing)).toEqual({
      ok: false,
      kind,
    });
  });
});

describe("event level persistence", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  const event = {
    seasonId: "22222222-2222-4222-8222-222222222222",
    name: "Provincials",
    eventType: "tournament" as const,
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    timezone: "America/Toronto",
    level: "U18" as const,
    showLevel: false,
  };

  it("passes an event level and public visibility to create and update RPCs", async () => {
    await createEvent(user, event);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "create_event",
      expect.objectContaining({ p_level: "U18", p_show_level: false }),
    );
    await updateEvent(user, "33333333-3333-4333-8333-333333333333", event);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "update_event",
      expect.objectContaining({ p_level: "U18", p_show_level: false }),
    );
  });
});
