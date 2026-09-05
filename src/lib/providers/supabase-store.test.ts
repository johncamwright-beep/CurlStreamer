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
  listCameraIdentityGenerations,
  prepareRoleInvitation,
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
      action: {
        type: "score",
        intentId: "10000000-0000-4000-8000-000000000001",
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "home",
        points: 2,
        blank: false,
      } as const,
      expected: { type: "end", team: "home", points: 2, blank: false },
    },
    {
      name: "blank end",
      action: {
        type: "score",
        intentId: "10000000-0000-4000-8000-000000000002",
        expectedEnd: 1,
        expectedLastEventId: null,
        team: null,
        points: 0,
        blank: true,
      } as const,
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
      expect(event.id).toBe(action.intentId);
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

  it("treats a matching persisted intent as an idempotent retry", async () => {
    const game = storedGame();
    const intentId = "10000000-0000-4000-8000-000000000014";
    game.scoreEvents.push({
      id: intentId,
      at: 1,
      type: "end",
      score: { end: 1, team: "home", points: 2, blank: false },
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 42 },
      error: null,
    });

    await expect(
      updateGame(game.id, {
        type: "score",
        intentId,
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "home",
        points: 2,
        blank: false,
      }),
    ).resolves.toBe(game);
    expect(game.scoreEvents).toHaveLength(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a reused intent with different scoring data", async () => {
    const game = storedGame();
    const intentId = "10000000-0000-4000-8000-000000000015";
    game.scoreEvents.push({
      id: intentId,
      at: 1,
      type: "end",
      score: { end: 1, team: "home", points: 2, blank: false },
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 43 },
      error: null,
    });

    await expect(
      updateGame(game.id, {
        type: "score",
        intentId,
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "away",
        points: 1,
        blank: false,
      }),
    ).rejects.toThrow("Scoring intent was already used");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a stale score instead of applying it to the next end", async () => {
    const game = storedGame();
    game.scoreEvents.push({
      id: "20000000-0000-4000-8000-000000000001",
      at: 1,
      type: "end",
      score: { end: 1, team: "home", points: 1, blank: false },
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 44 },
      error: null,
    });

    await expect(
      updateGame(game.id, {
        type: "score",
        intentId: "10000000-0000-4000-8000-000000000016",
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "away",
        points: 2,
        blank: false,
      }),
    ).rejects.toThrow("Scoring history position changed");
    expect(game.scoreEvents).toHaveLength(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["home", "away"] as const)(
    "appends a %s hammer selection without changing score or end",
    async (team) => {
      const game = storedGame();
      delete game.config.initialHammer;
      mocks.maybeSingle.mockResolvedValue({
        data: { state: game, version: 40 },
        error: null,
      });

      const result = await updateGame(game.id, {
        type: "hammer",
        intentId: "10000000-0000-4000-8000-000000000003",
        expectedEnd: 1,
        expectedLastEventId: null,
        team,
      });

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
        intentId: "10000000-0000-4000-8000-000000000004",
        expectedEnd: 1,
        expectedLastEventId: null,
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

    const result = await updateGame(game.id, {
      type: "undo",
      intentId: "10000000-0000-4000-8000-000000000005",
      expectedLastEventId: "22222222-2222-4222-8222-222222222222",
      expectedTargetId: "22222222-2222-4222-8222-222222222222",
    });

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

  it("rejects Undo after another scoring change becomes the latest target", async () => {
    const game = storedGame();
    game.scoreEvents.push(
      {
        id: "20000000-0000-4000-8000-000000000002",
        at: 1,
        type: "end",
        score: { end: 1, team: "home", points: 1, blank: false },
      },
      {
        id: "20000000-0000-4000-8000-000000000003",
        at: 2,
        type: "hammer",
        team: "away",
      },
    );
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 45 },
      error: null,
    });

    await expect(
      updateGame(game.id, {
        type: "undo",
        intentId: "10000000-0000-4000-8000-000000000017",
        expectedLastEventId: "20000000-0000-4000-8000-000000000003",
        expectedTargetId: "20000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow("Scoring history changed before Undo");
    expect(game.scoreEvents).toHaveLength(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
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
        intentId: "10000000-0000-4000-8000-000000000006",
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "home",
        points: 1,
        blank: false,
      }),
    ).rejects.toThrow("Score update conflict");
    expect(mocks.maybeSingle).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
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
      updateGame(game.id, {
        type: "hammer",
        intentId: "10000000-0000-4000-8000-000000000007",
        expectedEnd: 1,
        expectedLastEventId: null,
        team: "away",
      }),
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
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it("retries camera live state on fresh scored state without erasing the score", async () => {
    const claimant = "77777777-7777-4777-8777-777777777777";
    const first = storedGame();
    first.claims["camera-home"] = claimant;
    const latest = storedGame();
    latest.claims["camera-home"] = claimant;
    latest.scoreEvents.push({
      id: "88888888-8888-4888-8888-888888888888",
      at: 2,
      type: "end",
      score: { end: 1, team: "home", points: 2, blank: false },
    });
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 60 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 61 },
        error: null,
      });
    mocks.rpc
      .mockResolvedValueOnce({
        error: { code: "40001", message: "stale game state" },
      })
      .mockResolvedValueOnce({ error: null });

    const result = await updateGame(
      first.id,
      { type: "camera-health", role: "camera-home", phase: "live" },
      { role: "camera-home", claim: claimant },
    );

    expect(result?.scoreEvents).toEqual(latest.scoreEvents);
    expect(result?.cameraHealth?.["camera-home"]?.phase).toBe("live");
    expect(mocks.rpc).toHaveBeenLastCalledWith("write_game_state", {
      p_game_id: first.id,
      p_expected_version: 61,
      p_state: result,
    });
  });

  it("retries a final disconnected update against fresh state", async () => {
    const claimant = "99999999-9999-4999-8999-999999999999";
    const first = storedGame();
    first.claims["camera-away"] = claimant;
    const latest = storedGame();
    latest.claims["camera-away"] = claimant;
    latest.layout = "away";
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 62 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 63 },
        error: null,
      });
    mocks.rpc
      .mockResolvedValueOnce({
        error: { code: "40001", message: "stale game state" },
      })
      .mockResolvedValueOnce({ error: null });

    const result = await updateGame(
      first.id,
      {
        type: "camera-health",
        role: "camera-away",
        phase: "disconnected",
      },
      { role: "camera-away", claim: claimant },
    );

    expect(result?.layout).toBe("away");
    expect(result?.connections["camera-away"]).toBe(false);
    expect(result?.cameraHealth?.["camera-away"]?.phase).toBe("disconnected");
  });

  it.each([
    ["released", undefined],
    ["reassigned", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  ] as const)(
    "does not revive a %s camera claim while retrying health",
    async (_case, replacement) => {
      const claimant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const first = storedGame();
      first.claims["camera-home"] = claimant;
      const latest = storedGame();
      if (replacement) latest.claims["camera-home"] = replacement;
      mocks.maybeSingle
        .mockResolvedValueOnce({
          data: { state: first, version: 64 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { state: latest, version: 65 },
          error: null,
        });
      mocks.rpc.mockResolvedValueOnce({
        error: { code: "40001", message: "stale game state" },
      });

      await expect(
        updateGame(
          first.id,
          { type: "camera-health", role: "camera-home", phase: "live" },
          { role: "camera-home", claim: claimant },
        ),
      ).rejects.toThrow("Camera assignment changed");
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(latest.connections["camera-home"]).toBe(false);
      expect(latest.cameraHealth?.["camera-home"]).toBeUndefined();
    },
  );

  it("stops a same-device retry when its assignment generation changed", async () => {
    const claimant = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const first = storedGame();
    first.claims["camera-home"] = claimant;
    first.claimGenerations = { "camera-home": 7 };
    const latest = storedGame();
    latest.claims["camera-home"] = claimant;
    latest.claimGenerations = { "camera-home": 9 };
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 69 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 70 },
        error: null,
      });
    mocks.rpc.mockResolvedValueOnce({
      error: { code: "40001", message: "stale game state" },
    });

    await expect(
      updateGame(
        first.id,
        { type: "camera-health", role: "camera-home", phase: "live" },
        { role: "camera-home", claim: claimant, generation: 7 },
      ),
    ).rejects.toThrow("Camera assignment changed");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("rejects stale camera framing authority before writing", async () => {
    const claimant = "12121212-1212-4212-8212-121212121212";
    const game = storedGame();
    game.claims["camera-home"] = claimant;
    game.claimGenerations = { "camera-home": 9 };
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 73 },
      error: null,
    });

    await expect(
      updateGame(
        game.id,
        { type: "camera-framing", role: "camera-home", mode: "contain" },
        { role: "camera-home", claim: claimant, generation: 7 },
      ),
    ).rejects.toThrow("Camera assignment changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts current camera framing authority", async () => {
    const claimant = "13131313-1313-4313-8313-131313131313";
    const game = storedGame();
    game.claims["camera-home"] = claimant;
    game.claimGenerations = { "camera-home": 9 };
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 74 },
      error: null,
    });

    await expect(
      updateGame(
        game.id,
        { type: "camera-framing", role: "camera-home", mode: "contain" },
        { role: "camera-home", claim: claimant, generation: 9 },
      ),
    ).resolves.toMatchObject({
      cameraFraming: { "camera-home": "contain" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "write_game_state",
      expect.anything(),
    );
  });

  it("uses the trusted authority role instead of the action role", async () => {
    const claimant = "16161616-1616-4616-8616-161616161616";
    const game = storedGame();
    game.claims = {
      "camera-home": claimant,
      "camera-away": claimant,
    };
    game.claimGenerations = { "camera-home": 3, "camera-away": 3 };
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 77 },
      error: null,
    });

    await expect(
      updateGame(
        game.id,
        { type: "camera-framing", role: "camera-away", mode: "contain" },
        { role: "camera-home", claim: claimant, generation: 3 },
      ),
    ).rejects.toThrow("Participant role changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale scorer authority without rebasing score intent", async () => {
    const claimant = "14141414-1414-4414-8414-141414141414";
    const game = storedGame();
    game.claims.scorer = claimant;
    game.claimGenerations = { scorer: 6 };
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 75 },
      error: null,
    });

    await expect(
      updateGame(
        game.id,
        {
          type: "score",
          intentId: "10000000-0000-4000-8000-000000000008",
          expectedEnd: 1,
          expectedLastEventId: null,
          team: "home",
          points: 1,
          blank: false,
        },
        { role: "scorer", claim: claimant, generation: 4 },
      ),
    ).rejects.toThrow("Participant assignment changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts current scorer authority for one atomic score write", async () => {
    const claimant = "15151515-1515-4515-8515-151515151515";
    const game = storedGame();
    game.claims.scorer = claimant;
    game.claimGenerations = { scorer: 6 };
    mocks.maybeSingle.mockResolvedValue({
      data: { state: game, version: 76 },
      error: null,
    });

    await expect(
      updateGame(
        game.id,
        {
          type: "score",
          intentId: "10000000-0000-4000-8000-000000000009",
          expectedEnd: 1,
          expectedLastEventId: null,
          team: "home",
          points: 1,
          blank: false,
        },
        { role: "scorer", claim: claimant, generation: 6 },
      ),
    ).resolves.toMatchObject({
      scoreEvents: [expect.objectContaining({ type: "end" })],
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "append_score_event",
      expect.anything(),
    );
  });

  it("stops an organizer-observed retry when only the generation changed", async () => {
    const claimant = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const first = storedGame();
    first.claims["camera-home"] = claimant;
    first.claimGenerations = { "camera-home": 10 };
    const latest = storedGame();
    latest.claims["camera-home"] = claimant;
    latest.claimGenerations = { "camera-home": 12 };
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { state: first, version: 71 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { state: latest, version: 72 },
        error: null,
      });
    mocks.rpc.mockResolvedValueOnce({
      error: { code: "40001", message: "stale game state" },
    });

    await expect(
      updateGame(first.id, {
        type: "camera-health",
        role: "camera-home",
        phase: "live",
      }),
    ).rejects.toThrow("Camera assignment changed");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("stops camera retries after three conflicts", async () => {
    const claimant = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    for (const version of [66, 67, 68]) {
      const game = storedGame();
      game.claims["camera-home"] = claimant;
      mocks.maybeSingle.mockResolvedValueOnce({
        data: { state: game, version },
        error: null,
      });
    }
    mocks.rpc.mockResolvedValue({
      error: { code: "40001", message: "stale game state" },
    });

    await expect(
      updateGame(
        storedGame().id,
        { type: "connection", role: "camera-home", connected: true },
        { role: "camera-home", claim: claimant },
      ),
    ).rejects.toThrow("Game state update conflict");
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
});

describe("Supabase assignment generation RPCs", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.maybeSingle.mockReset();
  });

  it("prepares and claims an invitation with one generation", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 4, error: null })
      .mockResolvedValueOnce({
        data: [{ game_state: storedGame(), assignment_generation: 4 }],
        error: null,
      });
    await expect(
      prepareRoleInvitation(
        "game-1",
        "camera-home",
        "11111111-1111-4111-8111-111111111111",
        "2030-01-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ generation: 4 });
    await expect(
      claimRole(
        "game-1",
        "camera-home",
        "22222222-2222-4222-8222-222222222222",
        {
          id: "11111111-1111-4111-8111-111111111111",
          expectedGeneration: 4,
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      ),
    ).resolves.toMatchObject({ generation: 4 });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "prepare_game_role_invitation",
      "claim_game_role",
    ]);
  });

  it("maps a stale invitation to a safe conflict", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000" } });
    const result = await claimRole(
      "game-1",
      "camera-home",
      "22222222-2222-4222-8222-222222222222",
      {
        id: "11111111-1111-4111-8111-111111111111",
        expectedGeneration: 3,
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    );
    expect(result.error).toContain("stale");
  });

  it("releases only the expected claim and returns its generation", async () => {
    const expected = "55555555-5555-4555-8555-555555555555";
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          game_state: storedGame(),
          released: true,
          released_generation: 8,
        },
      ],
      error: null,
    });
    await expect(
      releaseRole("game-1", "camera-home", expected, 8),
    ).resolves.toMatchObject({ released: true, releasedGeneration: 8 });
    expect(mocks.rpc).toHaveBeenCalledWith("release_game_role", {
      p_game_id: "game-1",
      p_role: "camera-home",
      p_expected_claim: expected,
      p_expected_generation: 8,
    });
  });

  it("returns distinct persisted camera identity generations", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        { role: "camera-home", generation: 1 },
        { role: "camera-home", generation: 3 },
        { role: "camera-away", generation: 2 },
      ],
      error: null,
    });
    await expect(listCameraIdentityGenerations("game-1")).resolves.toEqual({
      "camera-home": [1, 3],
      "camera-away": [2],
    });
  });
});
