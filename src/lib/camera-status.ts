import type { CameraHealth, GameState } from "./types";

export const CAMERA_STALE_AFTER_MS = 75_000;
export type DisplayCameraStatus =
  | "Unclaimed"
  | "Claimed but offline"
  | "Connecting"
  | "Live"
  | "Reconnecting"
  | "Disconnected"
  | "Needs attention";

export function cameraDisplayStatus(
  game: Pick<GameState, "claims" | "cameraHealth">,
  role: "camera-home" | "camera-away",
  now = Date.now(),
): DisplayCameraStatus {
  if (!game.claims[role]) return "Unclaimed";
  const health: CameraHealth | undefined = game.cameraHealth?.[role];
  if (!health) return "Claimed but offline";
  if (health.phase === "live" && now - health.updatedAt > CAMERA_STALE_AFTER_MS)
    return "Needs attention";
  return {
    connecting: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    disconnected: "Disconnected",
    attention: "Needs attention",
  }[health.phase] as DisplayCameraStatus;
}
