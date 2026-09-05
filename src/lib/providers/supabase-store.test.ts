import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveScore } from "../scoring";
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

import {
  claimRole,
  createGame,
  releaseRole,
  updateGame,
} from "./supabase-store";

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
  config: { ...config },
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

  it.each(["home", "away"] as const)(
    "appends a %s hammer selection without changing score or end",
    async (team) => {
      const game = storedGame();
      delete game.config.initialHammer;
      mocks.maybeSingle.mockResolvedValue({
        data: { state: game, version: 40 },
        error: null,
      });

      const result = await updateGame(game.id, { type: "hammer", team });

      expect(result!.scoreEvents).toHaveLength(1);
      expect(result!.scoreEvents[0]).toMatchObject({ type: "hammer", team });
      expect(deriveScore(result!).currentEnd).toBe(1);
      expect(deriveScore(result!).totals).toEqual({ home: 0, away: 0 });
      expect(mocks.rpc).toHaveBeenCalledWith(
        "append_score_event",
        expect.objectContaining({
          p_expected_version: 40,
          p_event_type: "hammer",
        }),
      );
    },
  );

  it("blocks scoring before hammer is persisted", async () => {
    const game = storedGame();
    delete game.config.initialHammer;
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 39 },
      error: null,
    });

    await expect(
      updateGame(game.id, {
        type: "score",
        team: "home",
        points: 1,
        blank: false,
      }),
    ).rejects.toThrow("Hammer must be selected before scoring");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

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
    ).rejects.toThrow("Score update conflict");
  });

  it("reports a persistence failure without returning false success", async () => {
    const game = storedGame();
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 44 },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      error: { code: "XX000", message: "storage unavailable" },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      updateGame(game.id, { type: "hammer", team: "away" }),
    ).rejects.toThrow("Supabase score update failed");
  });

  it("keeps deletion's legacy Close Game retry harmless after completion", async () => {
    const game = storedGame();
    game.status = "completed";
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 46 },
      error: null,
    });

    await expect(updateGame(game.id, { type: "close-game" })).resolves.toBe(
      game,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects non-idempotent provider writes to a completed state", async () => {
    const game = storedGame();
    game.status = "completed";
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 47 },
      error: null,
    });

    await expect(
      updateGame(game.id, { type: "broadcast", value: "live" }),
    ).rejects.toThrow("This game is completed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { active: true, style: "overlay" as const },
    { active: false, style: "overlay" as const },
    { active: true, style: "fullscreen" as const },
  ])(
    "preserves manual audio for rapid sponsor mode change %#",
    async ({ active, style }) => {
      const game = storedGame();
      game.audioMuted = false;
      mocks.maybeSingle.mockResolvedValue({
        data: { state: game, version: 45 },
        error: null,
      });

      const result = await updateGame(game.id, {
        type: "sponsor-mode",
        active,
        style,
      });

      expect(result!.audioMuted).toBe(false);
      expect(result!.sponsorMode).toMatchObject({ active, style });
      expect(mocks.rpc).toHaveBeenCalledWith("write_game_state", {
        p_game_id: game.id,
        p_expected_version: 45,
        p_state: result,
      });
    },
  );

  it("uses expected-version CAS for ordinary state writes", async () => {
    const game = storedGame();
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 48 },
      error: null,
    });

    const result = await updateGame(game.id, {
      type: "camera-health",
      role: "camera-home",
      phase: "live",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("write_game_state", {
      p_game_id: game.id,
      p_expected_version: 48,
      p_state: result,
    });
  });

  it("surfaces an ordinary stale write as a state conflict", async () => {
    const game = storedGame();
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 49 },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      error: { code: "40001", message: "stale game state" },
    });

    await expect(
      updateGame(game.id, {
        type: "connection",
        role: "camera-home",
        connected: true,
      }),
    ).rejects.toThrow("Game state update conflict");
  });
});

describe("Supabase claim concurrency", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.maybeSingle.mockReset();
  });

  it("rechecks availability and retries a safe claim after a stale write", async () => {
    const first = storedGame();
    const latest = storedGame();
    latest.layout = "away";
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 50 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 51 },
        error: null,
      });
    mocks.rpc
      .mockResolvedValueOnce({
        error: { code: "40001", message: "stale game state" },
      })
      .mockResolvedValueOnce({ error: null });

    const result = await claimRole(
      first.id,
      "camera-home",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(result.error).toBeUndefined();
    expect(result.game?.layout).toBe("away");
    expect(mocks.rpc).toHaveBeenLastCalledWith("write_game_state", {
      p_game_id: first.id,
      p_expected_version: 51,
      p_state: result.game,
    });
  });

  it("does not overwrite a competing claim after a CAS conflict", async () => {
    const first = storedGame();
    const latest = storedGame();
    latest.claims["camera-home"] = "33333333-3333-4333-8333-333333333333";
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 52 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 53 },
        error: null,
      });
    mocks.rpc.mockResolvedValueOnce({
      error: { code: "40001", message: "stale game state" },
    });

    const result = await claimRole(
      first.id,
      "camera-home",
      "44444444-4444-4444-8444-444444444444",
    );

    expect(result).toEqual({ error: "This role is already in use." });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("does not release a replacement claim after a CAS conflict", async () => {
    const expected = "55555555-5555-4555-8555-555555555555";
    const first = storedGame();
    first.claims["camera-home"] = expected;
    const latest = storedGame();
    latest.claims["camera-home"] = "66666666-6666-4666-8666-666666666666";
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 54 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 55 },
        error: null,
      });
    mocks.rpc.mockResolvedValueOnce({
      error: { code: "40001", message: "stale game state" },
    });

    const result = await releaseRole(first.id, "camera-home", expected);

    expect(result).toEqual({ error: "Camera claim changed" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
