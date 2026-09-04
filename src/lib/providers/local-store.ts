import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GameConfig, GameState } from "../types";
import type { z } from "zod";
import type { actionSchema } from "../schema";
import { activeEvents, deriveScore } from "../scoring";

// Development-only persistence lets separate Next.js workers/browser contexts
// share one mock authority. It is intentionally outside the repository.
const storePath =
  process.env.CURLCAST_MOCK_STORE_PATH || join(tmpdir(), "curlcast-games.json");
const lockPath = `${storePath}.lock`;

function readGames() {
  try {
    return new Map<string, GameState>(
      Object.entries(
        JSON.parse(readFileSync(storePath, "utf8")) as Record<
          string,
          GameState
        >,
      ),
    );
  } catch {
    return new Map<string, GameState>();
  }
}

function writeGames(games: Map<string, GameState>) {
  const temporary = `${storePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(Object.fromEntries(games)), {
    mode: 0o600,
  });
  renameSync(temporary, storePath);
}

function mutate<T>(change: (games: Map<string, GameState>) => T): T {
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
    const games = readGames();
    const result = change(games);
    writeGames(games);
    return result;
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function createGame(config: GameConfig) {
  const id = randomUUID().slice(0, 8);
  const game: GameState = {
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
      rotationOffset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
  mutate((games) => games.set(id, game));
  return game;
}
export function getGame(id: string) {
  return readGames().get(id);
}
export function claimRole(
  id: string,
  role: keyof GameState["connections"],
  claimant: string,
) {
  return mutate((games) => {
    const game = games.get(id);
    if (!game) return { error: "Game not found" };
    if (game.status === "closed") return { error: "This game is closed." };
    if (game.claims[role] && game.claims[role] !== claimant)
      return { error: "This role is already in use." };
    game.claims[role] = claimant;
    return { game };
  });
}
export function releaseRole(
  id: string,
  role: "camera-home" | "camera-away",
  expectedClaim?: string,
) {
  return mutate((games) => {
    const game = games.get(id);
    if (!game) return { error: "Game not found" };
    const current = game.claims[role];
    if (!current) return { game, released: false };
    if (expectedClaim && current !== expectedClaim)
      return { error: "Camera claim changed" };
    delete game.claims[role];
    game.connections[role] = false;
    if (game.cameraHealth) delete game.cameraHealth[role];
    return { game, released: true };
  });
}
export function updateGame(id: string, action: z.infer<typeof actionSchema>) {
  return mutate((games) => {
    const game = games.get(id);
    if (!game) return;
    const now = Date.now();
    if (action.type === "score") {
      const s = deriveScore(game);
      if (!s.hammer) throw new Error("Hammer must be selected before scoring");
      game.scoreEvents.push({
        id: randomUUID(),
        at: now,
        type: "end",
        score: {
          end: s.currentEnd,
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
      const m = game.sponsorMode;
      m.active = action.active;
      if (action.style) m.style = action.style;
      if (action.intervalSeconds) m.intervalSeconds = action.intervalSeconds;
      m.startedAt = action.active ? now : null;
      m.rotationOffset = 0;
      m.paused = false;
    }
    if (action.type === "sponsor-nav") {
      if (action.direction) game.sponsorMode.rotationOffset += action.direction;
      if (action.paused !== undefined) game.sponsorMode.paused = action.paused;
      game.sponsorMode.startedAt = now;
    }
    return game;
  });
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
