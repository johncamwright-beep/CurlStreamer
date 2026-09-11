export type Team = "home" | "away";
export type Role = "camera-home" | "camera-away" | "scorer";
export type ParticipantAuthority = {
  role: Role;
  claim: string;
  /** Absent only for a generation-zero credential issued before migration 0019. */
  generation?: number;
};
export type Layout = "split" | "home" | "away" | "none";
export type SponsorStyle = "fullscreen" | "overlay";
export type CameraFraming = "fill" | "contain";

export interface GameConfig {
  homeLogoUrl?: string;
  eventName: string;
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  scheduledEnds: 8 | 10;
  /** Whether this scheduled game should reserve a YouTube watch page. */
  youtubeEnabled?: boolean;
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
  | {
      id: string;
      at: number;
      type: "end";
      score: EndScore;
      /** Exact scoring-history position observed when this intent was created. */
      expectedLastEventId?: string | null;
    }
  | {
      id: string;
      at: number;
      type: "hammer";
      team: Team;
      /** Present on position-bound scoring intents; absent on legacy events. */
      expectedEnd?: number;
      expectedLastEventId?: string | null;
    }
  | {
      id: string;
      at: number;
      type: "undo";
      targetId: string;
      expectedLastEventId?: string | null;
    };
export interface Sponsor {
  id: string;
  name: string;
  dataUrl: string;
  enabled: boolean;
  rotation: number;
  altText?: string;
  website?: string;
}
export interface LibrarySponsor {
  id: string;
  name: string;
  altText: string;
  imageUrl: string;
  archived: boolean;
  position: number;
  website?: string;
}
export interface GameState {
  id: string;
  config: GameConfig;
  /** Server-derived from the games row; absent for unscheduled or legacy games. */
  broadcastSchedule?: {
    scheduledStart: string;
    timezone: string;
  };
  createdAt: number;
  scoreEvents: ScoreEvent[];
  layout: Layout;
  broadcast: "idle" | "live";
  status: "active" | "closed" | "completed";
  audioMuted: boolean;
  connections: Record<Role, boolean>;
  cameraHealth?: Partial<Record<"camera-home" | "camera-away", CameraHealth>>;
  cameraFraming?: Partial<Record<"camera-home" | "camera-away", CameraFraming>>;
  cameraZoom?: Partial<Record<"camera-home" | "camera-away", CameraZoomState>>;
  /** Director microphone intent and the assigned phone's reported capture state. */
  cameraAudio?: Partial<
    Record<"camera-home" | "camera-away", CameraAudioState>
  >;
  claims: Partial<Record<Role, string>>;
  /** Opaque server-issued authority epochs; absent means legacy generation 0. */
  claimGenerations?: Partial<Record<Role, number>>;
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

/** Capability is reported by the assigned phone; commands are director intent. */
export interface CameraZoomState {
  supported: boolean;
  updatedAt: number;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  command?: { id: string; value: number; requestedAt: number };
}

export type CameraAudioStatus =
  "off" | "pending" | "active" | "permission-required" | "error";

export interface CameraAudioState {
  enabled: boolean;
  volume?: number;
  status: CameraAudioStatus;
  updatedAt: number;
  /** Assignment epoch targeted by this operator intent. Missing legacy state is inert. */
  generation?: number;
}

export type CameraHealthPhase =
  "connecting" | "live" | "reconnecting" | "disconnected" | "attention";
export interface CameraHealth {
  phase: CameraHealthPhase;
  updatedAt: number;
  diagnostic?: string;
}
