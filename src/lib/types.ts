export type Team = "home" | "away";
export type Role = "camera-home" | "camera-away" | "scorer";
export type Layout = "split" | "home" | "away";
export type SponsorStyle = "fullscreen" | "overlay";
export type CameraFraming = "fill" | "contain";

export interface GameConfig {
  eventName: string;
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  scheduledEnds: 8 | 10;
  /** Present on games created before hammer was selected on the scoring page. */
  initialHammer?: Team;
  youtubeTitle: string;
  youtubeVisibility: "unlisted" | "private" | "public";
}
export interface EndScore {
  end: number;
  team: Team | null;
  points: number;
  blank: boolean;
}
export type ScoreEvent =
  | { id: string; at: number; type: "end"; score: EndScore }
  | { id: string; at: number; type: "hammer"; team: Team }
  | { id: string; at: number; type: "undo"; targetId: string };
export interface Sponsor {
  id: string;
  name: string;
  /** Optional management label; name remains the accessible image text. */
  displayName?: string;
  dataUrl: string;
  enabled: boolean;
  rotation: number;
}
export interface GameState {
  id: string;
  config: GameConfig;
  createdAt: number;
  scoreEvents: ScoreEvent[];
  layout: Layout;
  broadcast: "idle" | "live";
  status: "active" | "closed";
  audioMuted: boolean;
  connections: Record<Role, boolean>;
  cameraHealth?: Partial<Record<"camera-home" | "camera-away", CameraHealth>>;
  cameraFraming?: Partial<Record<"camera-home" | "camera-away", CameraFraming>>;
  claims: Partial<Record<Role, string>>;
  sponsors: Sponsor[];
  sponsorMode: {
    active: boolean;
    style: SponsorStyle;
    intervalSeconds: number;
    startedAt: number | null;
    rotationOffset: number;
    paused: boolean;
    mutedPrevious: boolean;
    muteDuring: boolean;
  };
}

export type CameraHealthPhase =
  "connecting" | "live" | "reconnecting" | "disconnected" | "attention";
export interface CameraHealth {
  phase: CameraHealthPhase;
  updatedAt: number;
  diagnostic?: string;
}
