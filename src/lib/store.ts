import "server-only";
import { createHash, randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { z } from "zod";
import type { actionSchema } from "./schema";
import { activeEvents, deriveScore } from "./scoring";
import type { GameConfig, GameState, Role } from "./types";
import { getSupabaseGameStore } from "./providers/supabase-game-store";

export type GameAction = z.infer<typeof actionSchema>;
export type ClaimResult = { game?: GameState; error?: string };

export interface GameStore {
  createGame(config: GameConfig): Promise<GameState>;
  getGame(id: string): Promise<GameState | undefined>;
  registerInvitation(gameId: string, token: string, role: Role): Promise<void>;
  claimRole(
    id: string,
    role: Role,
    claimant: string,
    token: string,
  ): Promise<ClaimResult>;
  updateGame(id: string, action: GameAction): Promise<GameState | undefined>;
}

export function invitationHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newGame(
  config: GameConfig,
  id: string = randomUUID(),
): GameState {
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
    sponsors: sampleSponsors(),
    sponsorMode: {
      active: false,
      style: "fullscreen",
      intervalSeconds: 4,
      startedAt: null,
      offset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
}

export function applyGameAction(game: GameState, action: GameAction) {
  const next = structuredClone(game);
  const now = Date.now();
  if (action.type === "score") {
    const score = deriveScore(next);
    next.scoreEvents.push({
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
    next.scoreEvents.push({
      id: randomUUID(),
      at: now,
      type: "hammer",
      team: action.team,
    });
  if (action.type === "undo") {
    const target = activeEvents(next.scoreEvents).at(-1);
    if (target)
      next.scoreEvents.push({
        id: randomUUID(),
        at: now,
        type: "undo",
        targetId: target.id,
      });
  }
  if (action.type === "layout") next.layout = action.layout;
  if (action.type === "audio") next.audioMuted = action.muted;
  if (action.type === "broadcast") next.broadcast = action.value;
  if (action.type === "close-game") {
    next.status = "closed";
    next.broadcast = "idle";
    next.sponsorMode.active = false;
    next.connections = {
      "camera-home": false,
      "camera-away": false,
      scorer: false,
    };
  }
  if (action.type === "connection")
    next.connections[action.role] = action.connected;
  if (action.type === "sponsors") next.sponsors = action.sponsors;
  if (action.type === "sponsor-mode") {
    const mode = next.sponsorMode;
    mode.active = action.active;
    if (action.style) mode.style = action.style;
    if (action.intervalSeconds) mode.intervalSeconds = action.intervalSeconds;
    mode.startedAt = action.active ? now : null;
    mode.offset = 0;
    mode.paused = false;
    if (action.active && mode.muteDuring) {
      mode.mutedPrevious = next.audioMuted;
      next.audioMuted = true;
    } else if (!action.active && mode.muteDuring)
      next.audioMuted = mode.mutedPrevious;
  }
  if (action.type === "sponsor-nav") {
    if (action.direction) next.sponsorMode.offset += action.direction;
    if (action.paused !== undefined) next.sponsorMode.paused = action.paused;
    next.sponsorMode.startedAt = now;
  }
  return next;
}

type LocalData = {
  games: Record<string, GameState>;
  invitations: Record<
    string,
    { gameId: string; role: Role; claimedBy?: string }
  >;
};

const defaultStorePath =
  process.env.CURLCAST_MOCK_STORE_PATH || join(tmpdir(), "curlcast-games.json");

function readLocal(storePath: string): LocalData {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8"));
    if (parsed.games) return parsed as LocalData;
    return { games: parsed as Record<string, GameState>, invitations: {} };
  } catch {
    return { games: {}, invitations: {} };
  }
}

function mutateLocal<T>(storePath: string, change: (data: LocalData) => T): T {
  const lockPath = `${storePath}.lock`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      if (attempt >= 100) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    const data = readLocal(storePath);
    const result = change(data);
    const temporary = `${storePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    renameSync(temporary, storePath);
    return result;
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function createLocalGameStore(storePath = defaultStorePath): GameStore {
  return {
    async createGame(config) {
      const game = newGame(config, randomUUID().slice(0, 8));
      mutateLocal(storePath, (data) => void (data.games[game.id] = game));
      return game;
    },
    async getGame(id) {
      return readLocal(storePath).games[id];
    },
    async registerInvitation(gameId, token, role) {
      mutateLocal(storePath, (data) => {
        data.invitations[invitationHash(token)] = { gameId, role };
      });
    },
    async claimRole(id, role, claimant, token) {
      return mutateLocal(storePath, (data) => {
        const game = data.games[id];
        if (!game) return { error: "Game not found" };
        if (game.status === "closed") return { error: "This game is closed." };
        const invitation = data.invitations[invitationHash(token)];
        if (!invitation || invitation.gameId !== id || invitation.role !== role)
          return { error: "This link is invalid or expired." };
        if (invitation.claimedBy && invitation.claimedBy !== claimant)
          return { error: "This invitation has already been used." };
        if (game.claims[role] && game.claims[role] !== claimant)
          return { error: "This role is already in use." };
        invitation.claimedBy = claimant;
        game.claims[role] = claimant;
        return { game };
      });
    },
    async updateGame(id, action) {
      return mutateLocal(storePath, (data) => {
        const game = data.games[id];
        if (!game) return undefined;
        const next = applyGameAction(game, action);
        data.games[id] = next;
        return next;
      });
    },
  };
}

let store: GameStore | undefined;
export function getGameStore() {
  if (!store) store = getSupabaseGameStore() ?? createLocalGameStore();
  return store;
}

function sampleSponsors() {
  return [
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
  ];
}
