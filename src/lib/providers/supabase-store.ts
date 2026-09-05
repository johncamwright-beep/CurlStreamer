import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { z } from "zod";
import type { actionSchema } from "../schema";
import { activeEvents, deriveScore } from "../scoring";
import type { GameConfig, GameState } from "../types";
import {
  GameStateConflictError,
  isGameStateConflictError,
} from "../game-state-conflict";

let client: SupabaseClient | undefined;

function supabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}

function databaseError(
  operation: string,
  error: { code?: string; message: string } | null,
): never {
  const secrets = [
    process.env.SUPABASE_SECRET_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ].filter((value): value is string => Boolean(value));
  let message = error?.message ?? "unknown error";
  for (const secret of secrets)
    message = message.replaceAll(secret, "[redacted]");
  message = message
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted]",
    )
    .replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, "$1[redacted]@")
    .slice(0, 500);
  console.error(`Supabase ${operation} failed`, {
    code: error?.code ?? "unknown",
    message,
  });
  throw new Error(`Supabase ${operation} failed`);
}

function initialState(id: string, config: GameConfig): GameState {
  return {
    id,
    config,
    createdAt: Date.now(),
    scoreEvents: [],
    layout: "split",
    broadcast: "idle",
    status: "active",
    audioMuted: false,
    connections: { "camera-home": false, "camera-away": false, scorer: false },
    claims: {},
    sponsors: [
      {
        id: "sample-ice",
        name: "Community Ice",
        dataUrl: "/sponsors/community.svg",
        enabled: true,
        rotation: 0,
      },
      {
        id: "sample-rock",
        name: "Rock Solid",
        dataUrl: "/sponsors/rock.svg",
        enabled: true,
        rotation: 0,
      },
    ],
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
  };
}

export async function createGame(config: GameConfig) {
  const db = supabase();
  const id = randomUUID();
  const game = initialState(id, config);
  const { error } = await db.rpc("create_game", {
    p_game_id: id,
    p_config: config,
    p_state: game,
  });
  if (error) databaseError("game creation", error);
  return game;
}

export async function getGame(id: string) {
  const record = await getGameRecord(id);
  return record?.state;
}

async function getGameRecord(id: string) {
  const { data, error } = await supabase()
    .from("game_states")
    .select("state, version")
    .eq("game_id", id)
    .maybeSingle();
  if (error) databaseError("game lookup", error);
  if (!data) return undefined;
  return { state: data.state as GameState, version: data.version as number };
}

export async function claimRole(
  id: string,
  role: keyof GameState["connections"],
  claimant: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await getGameRecord(id);
    if (!record) return { error: "Game not found" };
    const game = record.state;
    if (game.status !== "active") return { error: "This game is closed." };
    const current = game.claims[role];
    if (current === claimant) return { game };
    if (current) return { error: "This role is already in use." };
    game.claims[role] = claimant;
    try {
      await save(game, record.version);
      return { game };
    } catch (error) {
      if (!isGameStateConflictError(error)) throw error;
    }
  }
  return { error: "The game changed before this role could be claimed." };
}

export async function releaseRole(
  id: string,
  role: "camera-home" | "camera-away",
  expectedClaim?: string,
) {
  let targetClaim = expectedClaim;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await getGameRecord(id);
    if (!record) return { error: "Game not found" };
    const game = record.state;
    const current = game.claims[role];
    if (!current) return { game, released: false };
    targetClaim ??= current;
    if (current !== targetClaim) return { error: "Camera claim changed" };
    delete game.claims[role];
    game.connections[role] = false;
    if (game.cameraHealth) delete game.cameraHealth[role];
    try {
      await save(game, record.version);
      return { game, released: true };
    } catch (error) {
      if (!isGameStateConflictError(error)) throw error;
    }
  }
  return { error: "Camera claim changed" };
}

async function save(game: GameState, expectedVersion: number) {
  const { error } = await supabase().rpc("write_game_state", {
    p_game_id: game.id,
    p_expected_version: expectedVersion,
    p_state: game,
  });
  if (error?.code === "40001" || error?.code === "55000")
    throw new GameStateConflictError();
  if (error) databaseError("game update", error);
}

async function saveScoreEvent(
  game: GameState,
  expectedVersion: number,
  event: GameState["scoreEvents"][number],
) {
  const { error } = await supabase().rpc("append_score_event", {
    p_game_id: game.id,
    p_expected_version: expectedVersion,
    p_event_id: event.id,
    p_event_type: event.type,
    p_payload: event,
    p_actor: "server",
    p_state: game,
  });
  if (error?.code === "40001") throw new Error("Score update conflict");
  if (error) databaseError("score update", error);
}

function applyAction(game: GameState, action: z.infer<typeof actionSchema>) {
  const now = Date.now();
  let scoreEvent: GameState["scoreEvents"][number] | undefined;
  if (action.type === "score") {
    const score = deriveScore(game);
    if (!score.hammer)
      throw new Error("Hammer must be selected before scoring");
    scoreEvent = {
      id: randomUUID(),
      at: now,
      type: "end",
      score: {
        end: score.currentEnd,
        team: action.team,
        points: action.points,
        blank: action.blank,
      },
    };
    game.scoreEvents.push(scoreEvent);
  }
  if (action.type === "hammer") {
    scoreEvent = {
      id: randomUUID(),
      at: now,
      type: "hammer",
      team: action.team,
    };
    game.scoreEvents.push(scoreEvent);
  }
  if (action.type === "undo") {
    const target = activeEvents(game.scoreEvents).at(-1);
    if (target) {
      scoreEvent = {
        id: randomUUID(),
        at: now,
        type: "undo",
        targetId: target.id,
      };
      game.scoreEvents.push(scoreEvent);
    }
  }
  if (action.type === "layout") game.layout = action.layout;
  if (action.type === "camera-framing") {
    game.cameraFraming ??= {};
    game.cameraFraming[action.role] = action.mode;
  }
  if (action.type === "audio") game.audioMuted = action.muted;
  if (action.type === "broadcast") game.broadcast = action.value;
  if (action.type === "close-game") {
    game.status = "closed";
    game.broadcast = "idle";
    game.sponsorMode.active = false;
    game.connections = {
      "camera-home": false,
      "camera-away": false,
      scorer: false,
    };
  }
  if (action.type === "connection")
    game.connections[action.role] = action.connected;
  if (action.type === "camera-health") {
    game.cameraHealth ??= {};
    game.cameraHealth[action.role] = {
      phase: action.phase,
      updatedAt: now,
      ...(action.diagnostic ? { diagnostic: action.diagnostic } : {}),
    };
    game.connections[action.role] = action.phase === "live";
  }
  if (action.type === "sponsors") game.sponsors = action.sponsors;
  if (action.type === "sponsor-mode") {
    const mode = game.sponsorMode;
    mode.active = action.active;
    if (action.style) mode.style = action.style;
    if (action.intervalSeconds) mode.intervalSeconds = action.intervalSeconds;
    mode.startedAt = action.active ? now : null;
    mode.rotationOffset = 0;
    mode.paused = false;
  }
  if (action.type === "sponsor-nav") {
    if (action.direction) game.sponsorMode.rotationOffset += action.direction;
    if (action.paused !== undefined) game.sponsorMode.paused = action.paused;
    game.sponsorMode.startedAt = now;
  }
  return scoreEvent;
}

export async function updateGame(
  id: string,
  action: z.infer<typeof actionSchema>,
  expectedClaim?: string,
) {
  const retryable =
    action.type === "camera-health" || action.type === "connection";
  const attempts = retryable ? 3 : 1;
  let capturedClaim = expectedClaim;
  let claimCaptured = expectedClaim !== undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const record = await getGameRecord(id);
    if (!record) return undefined;
    const game = record.state;
    if (game.status === "completed") {
      if (action.type === "close-game") return game;
      throw new Error("This game is completed");
    }
    if (retryable) {
      const currentClaim = game.claims[action.role];
      if (!claimCaptured) {
        capturedClaim = currentClaim;
        claimCaptured = true;
      }
      if (currentClaim !== capturedClaim)
        throw new GameStateConflictError("Camera assignment changed");
    }

    const scoreEvent = applyAction(game, action);
    try {
      if (scoreEvent) await saveScoreEvent(game, record.version, scoreEvent);
      else await save(game, record.version);
      return game;
    } catch (error) {
      if (
        !retryable ||
        !isGameStateConflictError(error) ||
        attempt === attempts - 1
      )
        throw error;
    }
  }
  throw new GameStateConflictError();
}
