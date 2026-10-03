import type { GameState } from "./types";

/** An intent is valid only for the camera assignment that existed when it was set. */
export function cameraAudioEnabled(
  game: Pick<GameState, "cameraAudio" | "claims" | "claimGenerations">,
  role: "camera-home" | "camera-away",
) {
  const audio = game.cameraAudio?.[role];
  return Boolean(
    audio?.enabled &&
    audio.generation !== undefined &&
    game.claims[role] &&
    audio.generation === (game.claimGenerations?.[role] ?? 0),
  );
}
