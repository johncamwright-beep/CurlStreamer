import { deriveScore } from "./scoring";
import { hasSafeSponsorContent } from "./schema";
import type { GameConfig, GameState, Sponsor, Team } from "./types";

export interface BroadcastGame {
  id: string;
  config: Pick<
    GameConfig,
    "eventName" | "homeName" | "awayName" | "homeColor" | "awayColor"
  >;
  score: {
    hammer: Team | null;
    totals: Record<Team, number>;
    currentEnd: number;
  };
  layout: GameState["layout"];
  broadcast: GameState["broadcast"];
  audioMuted: boolean;
  cameraFraming: GameState["cameraFraming"];
  sponsors: Sponsor[];
  sponsorMode: Pick<
    GameState["sponsorMode"],
    | "active"
    | "style"
    | "intervalSeconds"
    | "startedAt"
    | "rotationOffset"
    | "paused"
  >;
}

export interface JoinGame {
  config: Pick<GameConfig, "eventName">;
  claimedRoles: Record<keyof GameState["claims"], boolean>;
}

/** Explicit allowlists, including nested fields: never serialize stored objects. */
export function broadcastGame(
  game: GameState,
  renderableSponsors?: Sponsor[],
): BroadcastGame {
  const score = deriveScore(game);
  const sponsorSource = renderableSponsors?.length
    ? renderableSponsors
    : game.sponsors.filter(
        (sponsor) => sponsor.enabled && hasSafeSponsorContent(sponsor.dataUrl),
      );
  return {
    id: game.id,
    config: {
      eventName: game.config.eventName,
      homeName: game.config.homeName,
      awayName: game.config.awayName,
      homeColor: game.config.homeColor,
      awayColor: game.config.awayColor,
    },
    score: {
      hammer: score.hammer,
      totals: { home: score.totals.home, away: score.totals.away },
      currentEnd: score.currentEnd,
    },
    layout: game.layout,
    broadcast: game.broadcast,
    audioMuted: game.audioMuted,
    cameraFraming: {
      "camera-home": game.cameraFraming?.["camera-home"] ?? "fill",
      "camera-away": game.cameraFraming?.["camera-away"] ?? "fill",
    },
    // Only already embedded image content or bundled demo art is public.
    // Never forward signed URLs, private storage paths, or disabled assets.
    sponsors: sponsorSource
      .filter((sponsor) => sponsor.enabled)
      .map((s, index) => ({
        id: `broadcast-sponsor-${index}`,
        name: s.name,
        altText: s.altText,
        dataUrl: s.dataUrl,
        enabled: true,
        rotation: s.rotation,
      })),
    sponsorMode: {
      active: game.sponsorMode.active,
      style: game.sponsorMode.style,
      intervalSeconds: game.sponsorMode.intervalSeconds,
      startedAt: game.sponsorMode.startedAt,
      rotationOffset: game.sponsorMode.rotationOffset,
      paused: game.sponsorMode.paused,
    },
  };
}

export function joinGame(game: GameState): JoinGame {
  return {
    config: { eventName: game.config.eventName },
    claimedRoles: {
      "camera-home": Boolean(game.claims["camera-home"]),
      "camera-away": Boolean(game.claims["camera-away"]),
      scorer: Boolean(game.claims.scorer),
    },
  };
}
