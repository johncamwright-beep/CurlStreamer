import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { actionSchema } from "../schema";
import { applyScoringAction } from "../scoring";
import type { GameConfig, GameState, ParticipantAuthority } from "../types";
import {
  GameStateConflictError,
  GameClosedError,
  ScoringWriteConflictError,
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

export async function prepareRoleInvitation(
  id: string,
  role: keyof GameState["connections"],
  invitationId: string,
  expiresAt: string,
) {
  const { data, error } = await supabase().rpc("prepare_game_role_invitation", {
    p_game_id: id,
    p_role: role,
    p_invitation_id: invitationId,
    p_expires_at: expiresAt,
  });
  if (error) return { error: "This invitation could not be created." };
  return { generation: Number(data) };
}

export async function prepareCameraReconnect(
  id: string,
  role: "camera-home" | "camera-away",
  invitationId: string,
  expiresAt: string,
): Promise<{ error?: string; deviceId?: string; generation?: number }> {
  const { data, error } = await supabase().rpc(
    "prepare_game_camera_reconnect",
    {
      p_game_id: id,
      p_role: role,
      p_invitation_id: invitationId,
      p_expires_at: expiresAt,
    },
  );
  const result = z
    .object({
      deviceId: z.uuid(),
      generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .safeParse(data);
  if (error || !result.success)
    return {
      error: "This camera assignment is unavailable. Refresh the game.",
    };
  return result.data;
}

async function getGameRecord(id: string) {
  const { data, error } = await supabase()
    .from("game_states")
    // API roles may read game_states, but direct reads/joins of games are revoked.
    // Keep the stored config unchanged: writes use this same versioned snapshot.
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
  invitation: {
    id: string;
    expectedGeneration?: number;
    expiresAt: string;
  },
) {
  const { data, error } = await supabase().rpc("claim_game_role", {
    p_game_id: id,
    p_role: role,
    p_invitation_id: invitation.id,
    p_expected_generation: invitation.expectedGeneration ?? null,
    p_claimant: claimant,
    p_expires_at: invitation.expiresAt,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (error || !row)
    return { error: "This invitation is stale or the role is already in use." };
  return {
    game: row.game_state as GameState,
    generation: Number(row.assignment_generation),
  };
}

export async function releaseRole(
  id: string,
  role: "camera-home" | "camera-away",
  expectedClaim: string,
  expectedGeneration: number,
) {
  const { data, error } = await supabase().rpc("release_game_role", {
    p_game_id: id,
    p_role: role,
    p_expected_claim: expectedClaim,
    p_expected_generation: expectedGeneration,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (error || !row) return { error: "Camera claim changed" };
  return {
    game: row.game_state as GameState,
    released: Boolean(row.released),
    releasedGeneration: Number(row.released_generation),
  };
}

export async function listCameraIdentityGenerations(id: string) {
  const { data, error } = await supabase().rpc(
    "list_game_camera_identity_generations",
    { p_game_id: id },
  );
  if (error) databaseError("camera identity lookup", error);
  const generations: Partial<Record<"camera-home" | "camera-away", number[]>> =
    {};
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    const role = row.role as "camera-home" | "camera-away";
    if (role !== "camera-home" && role !== "camera-away") continue;
    const generation = Number(row.generation);
    if (!Number.isSafeInteger(generation) || generation <= 0) continue;
    (generations[role] ??= []).push(generation);
  }
  return generations;
}

async function save(game: GameState, expectedVersion: number) {
  const { error } = await supabase().rpc("write_game_state", {
    p_game_id: game.id,
    p_expected_version: expectedVersion,
    p_state: game,
  });
  if (error && ["PT409", "40001", "55000"].includes(error.code))
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
  if (error?.code === "PT409" || error?.code === "40001")
    throw new ScoringWriteConflictError("Score update conflict");
  if (error?.code === "55000")
    throw new GameClosedError("This game is completed");
  if (error) databaseError("score update", error);
}

function applyAction(game: GameState, action: z.infer<typeof actionSchema>) {
  const now = Date.now();
  const scoring =
    action.type === "score" ||
    action.type === "hammer" ||
    action.type === "undo"
      ? applyScoringAction(game, action, now)
      : undefined;
  if (action.type === "rock-colours") {
    game.config.homeColor = action.homeColor;
    game.config.awayColor = action.awayColor;
  }
  if (action.type === "layout") game.layout = action.layout;
  if (action.type === "program-audio-delay")
    game.programAudioDelayMs = action.milliseconds;
  if (action.type === "camera-pan") {
    game.cameraPan ??= {};
    game.cameraPan[action.role] = action.value;
  }
  if (action.type === "camera-composition")
    game.programCameraMode = action.mode;
  if (action.type === "camera-framing") {
    game.cameraFraming ??= {};
    game.cameraFraming[action.role] = action.mode;
  }
  if (action.type === "camera-zoom") {
    game.cameraZoom ??= {};
    const current = game.cameraZoom[action.role];
    game.cameraZoom[action.role] = {
      supported: current?.supported ?? false,
      updatedAt: current?.updatedAt ?? now,
      ...(current?.min !== undefined ? { min: current.min } : {}),
      ...(current?.max !== undefined ? { max: current.max } : {}),
      ...(current?.step !== undefined ? { step: current.step } : {}),
      ...(current?.value !== undefined ? { value: current.value } : {}),
      command: { id: action.commandId, value: action.value, requestedAt: now },
    };
  }
  if (action.type === "camera-reconnect") {
    game.cameraReconnect ??= {};
    game.cameraReconnect[action.role] = {
      id: action.commandId,
      requestedAt: now,
    };
  }
  if (action.type === "camera-zoom-status") {
    game.cameraZoom ??= {};
    const command = game.cameraZoom[action.role]?.command;
    game.cameraZoom[action.role] = {
      supported: action.supported,
      updatedAt: now,
      ...(action.supported
        ? {
            min: action.min!,
            max: action.max!,
            step: action.step!,
            value: action.value!,
          }
        : {}),
      ...(command ? { command } : {}),
    };
  }
  if (action.type === "camera-audio") {
    game.cameraAudio ??= {};
    game.cameraAudio[action.role] = {
      enabled: action.enabled,
      volume: action.volume ?? game.cameraAudio[action.role]?.volume ?? 1,
      status: action.enabled
        ? game.cameraAudio[action.role]?.enabled
          ? game.cameraAudio[action.role]!.status
          : "pending"
        : "off",
      updatedAt: now,
      generation: game.claimGenerations?.[action.role] ?? 0,
    };
  }
  if (action.type === "camera-audio-status") {
    game.cameraAudio ??= {};
    const current = game.cameraAudio[action.role];
    if (current)
      game.cameraAudio[action.role] = {
        ...current,
        status: action.status,
        updatedAt: now,
      };
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
  return scoring;
}

export async function updateGame(
  id: string,
  action: z.infer<typeof actionSchema>,
  expectedAuthority?: ParticipantAuthority,
) {
  const scoringAction =
    action.type === "score" ||
    action.type === "hammer" ||
    action.type === "undo";
  const retryable =
    scoringAction ||
    action.type === "camera-health" ||
    action.type === "connection" ||
    action.type === "camera-zoom-status" ||
    action.type === "camera-audio-status";
  const attempts = retryable ? 3 : 1;
  let capturedClaim: string | undefined;
  let capturedGeneration: number | undefined;
  let authorityCaptured = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const record = await getGameRecord(id);
    if (!record) return undefined;
    const game = record.state;
    if (game.status === "closed") throw new GameClosedError();
    if (game.status === "completed") {
      if (action.type === "close-game") return game;
      throw new GameClosedError("This game is completed");
    }
    if (expectedAuthority) {
      if (
        "role" in action &&
        action.role !== expectedAuthority.role &&
        !(
          (action.type === "camera-zoom" ||
            action.type === "camera-pan" ||
            action.type === "camera-audio" ||
            action.type === "camera-reconnect") &&
          expectedAuthority.role === "scorer"
        )
      )
        throw new GameStateConflictError("Participant role changed");
      const currentGeneration =
        game.claimGenerations?.[expectedAuthority.role] ?? 0;
      if (
        game.claims[expectedAuthority.role] !== expectedAuthority.claim ||
        (expectedAuthority.generation === undefined
          ? currentGeneration !== 0
          : currentGeneration !== expectedAuthority.generation)
      )
        throw new GameStateConflictError(
          expectedAuthority.role === "scorer"
            ? "Participant assignment changed"
            : "Camera assignment changed",
        );
    }
    if (retryable && !scoringAction && !expectedAuthority && "role" in action) {
      const currentClaim = game.claims[action.role];
      const currentGeneration = game.claimGenerations?.[action.role] ?? 0;
      if (!authorityCaptured) {
        capturedClaim = currentClaim;
        capturedGeneration = currentGeneration;
        authorityCaptured = true;
      }
      if (currentClaim !== capturedClaim)
        throw new GameStateConflictError("Camera assignment changed");
      if (currentGeneration !== capturedGeneration)
        throw new GameStateConflictError("Camera assignment changed");
    }

    // Replay only the original intent against a fresh snapshot. Its scoring
    // position and participant authority are checked on every attempt, so a
    // camera heartbeat may be merged but a competing scorer cannot advance it.
    const scoring = applyAction(game, action);
    if (scoring?.idempotent) return game;
    try {
      if (scoring?.event)
        await saveScoreEvent(game, record.version, scoring.event);
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
