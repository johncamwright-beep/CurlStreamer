import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameConfig, GameState } from "../types";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import { createGame, updateGame } from "./supabase-store";

const config: GameConfig = {
  eventName: "Club final",
  homeName: "Rocks",
  awayName: "Stones",
  homeColor: "#000000",
  awayColor: "#ffffff",
  scheduledEnds: 8,
  initialHammer: "home",
  youtubeTitle: "Club final",
  youtubeVisibility: "unlisted",
};

const storedGame = (): GameState => ({
  id: "11111111-1111-4111-8111-111111111111",
  config,
  createdAt: 1,
  scoreEvents: [],
  layout: "split",
  broadcast: "idle",
  status: "active",
  audioMuted: false,
  connections: { "camera-home": false, "camera-away": false, scorer: true },
  claims: {},
  sponsors: [],
  sponsorMode: {
    active: false,
    style: "fullscreen",
    intervalSeconds: 4,
    startedAt: null,
    rotationOffset: 0,
    paused: false,
    mutedPrevious: false,
    muteDuring: true,
  },
});

describe("Supabase game creation", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.maybeSingle.mockReset();
    vi.restoreAllMocks();
  });

  it("uses the transactional database function with matching arguments", async () => {
    mocks.rpc.mockResolvedValue({ error: null });

    const game = await createGame(config);

    expect(mocks.rpc).toHaveBeenCalledWith("create_game", {
      p_game_id: game.id,
      p_config: config,
      p_state: game,
    });
  });

  it("redacts credentials from logged database errors", async () => {
    process.env.SUPABASE_SECRET_KEY = "server-secret-value";
    mocks.rpc.mockResolvedValue({
      error: {
        code: "42501",
        message: "request server-secret-value was rejected",
      },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(createGame(config)).rejects.toThrow(
      "Supabase game creation failed",
    );
    expect(consoleError).toHaveBeenCalledWith("Supabase game creation failed", {
      code: "42501",
      message: "request [redacted] was rejected",
    });
  });
});

describe("Supabase score-event persistence", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.maybeSingle.mockReset();
  });

  it.each([
    {
      name: "score",
      action: { type: "score", team: "home", points: 2, blank: false } as const,
      expected: { type: "end", team: "home", points: 2, blank: false },
    },
    {
      name: "blank end",
      action: { type: "score", team: null, points: 0, blank: true } as const,
      expected: { type: "end", team: null, points: 0, blank: true },
    },
  ])(
    "atomically persists a $name event and state",
    async ({ action, expected }) => {
      const game = storedGame();
      mocks.maybeSingle.mockResolvedValue({
        data: { state: game, version: 41 },
        error: null,
      });

      const result = await updateGame(game.id, action);

      const event = result!.scoreEvents[0];
      expect(event).toMatchObject(
        expected.type === "end"
          ? {
              type: "end",
              score: {
                team: expected.team,
                points: expected.points,
                blank: expected.blank,
              },
            }
          : expected,
      );
      expect(mocks.rpc).toHaveBeenCalledWith("append_score_event", {
        p_game_id: game.id,
        p_expected_version: 41,
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload: event,
        p_actor: "server",
        p_state: result,
      });
    },
  );

  it("appends Undo without deleting its target", async () => {
    const game = storedGame();
    game.scoreEvents.push({
      id: "22222222-2222-4222-8222-222222222222",
      at: 2,
      type: "end",
      score: { end: 1, team: "away", points: 1, blank: false },
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 42 },
      error: null,
    });

    const result = await updateGame(game.id, { type: "undo" });

    expect(result!.scoreEvents).toHaveLength(2);
    expect(result!.scoreEvents[0]).toMatchObject({ type: "end" });
    expect(result!.scoreEvents[1]).toMatchObject({
      type: "undo",
      targetId: "22222222-2222-4222-8222-222222222222",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "append_score_event",
      expect.objectContaining({
        p_expected_version: 42,
        p_event_type: "undo",
        p_payload: result!.scoreEvents[1],
        p_state: result,
      }),
    );
  });

  it("rejects the update when the atomic RPC fails", async () => {
    const game = storedGame();
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 43 },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      error: { code: "40001", message: "stale game state" },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      updateGame(game.id, {
        type: "score",
        team: "home",
        points: 1,
        blank: false,
      }),
    ).rejects.toThrow("Supabase score update failed");
  });
});
