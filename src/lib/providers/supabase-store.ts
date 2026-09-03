import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { z } from "zod";
import type { actionSchema } from "../schema";
import { activeEvents, deriveScore } from "../scoring";
import type { GameConfig, GameState } from "../types";

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
  const { data, error } = await supabase()
    .from("game_states")
    .select("state")
    .eq("game_id", id)
    .maybeSingle();
  if (error) databaseError("game lookup", error);
  return data?.state as GameState | undefined;
}

export async function claimRole(
  id: string,
  role: keyof GameState["connections"],
  claimant: string,
) {
  const game = await getGame(id);
  if (!game) return { error: "Game not found" };
  if (game.status === "closed") return { error: "This game is closed." };
  if (game.claims[role] && game.claims[role] !== claimant)
    return { error: "This role is already in use." };
  game.claims[role] = claimant;
  await save(game);
  return { game };
}

async function save(game: GameState) {
  const { error } = await supabase()
    .from("game_states")
    .update({
      state: game,
      version: Date.now(),
      updated_at: new Date().toISOString(),
    })
    .eq("game_id", game.id);
  if (error) databaseError("game update", error);
}

export async function updateGame(
  id: string,
  action: z.infer<typeof actionSchema>,
) {
  const game = await getGame(id);
  if (!game) return undefined;
  const now = Date.now();
  if (action.type === "score") {
    const score = deriveScore(game);
    game.scoreEvents.push({
      id: randomUUID(),
      at: now,
      type: "end",
      score: {
        end: score.currentEnd,
        team: action.team,
        points: action.points,
        blank: action.blank,
      },
    });
  }
  if (action.type === "hammer")
    game.scoreEvents.push({
      id: randomUUID(),
      at: now,
      type: "hammer",
      team: action.team,
    });
  if (action.type === "undo") {
    const target = activeEvents(game.scoreEvents).at(-1);
    if (target)
      game.scoreEvents.push({
        id: randomUUID(),
        at: now,
        type: "undo",
        targetId: target.id,
      });
  }
  if (action.type === "layout") game.layout = action.layout;
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
  if (action.type === "sponsors") game.sponsors = action.sponsors;
  if (action.type === "sponsor-mode") {
    const mode = game.sponsorMode;
    mode.active = action.active;
    if (action.style) mode.style = action.style;
    if (action.intervalSeconds) mode.intervalSeconds = action.intervalSeconds;
    mode.startedAt = action.active ? now : null;
    mode.rotationOffset = 0;
    mode.paused = false;
    if (action.active && mode.muteDuring) {
      mode.mutedPrevious = game.audioMuted;
      game.audioMuted = true;
    } else if (!action.active && mode.muteDuring)
      game.audioMuted = mode.mutedPrevious;
  }
  if (action.type === "sponsor-nav") {
    if (action.direction) game.sponsorMode.rotationOffset += action.direction;
    if (action.paused !== undefined) game.sponsorMode.paused = action.paused;
    game.sponsorMode.startedAt = now;
  }
  await save(game);
  return game;
}
