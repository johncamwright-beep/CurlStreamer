import type { GameState } from "./types";
import type { PrivateProgramGame } from "./game-projection";
import type { M4CameraInputSnapshot } from "./m4-camera-input";

/** Native sources use organizer intent; phone sources retain assignment checks. */
export function cameraAudioControlEnabled(
  game: Pick<GameState, "cameraAudio" | "claims" | "claimGenerations">,
  role: "camera-home" | "camera-away",
  sourceKind?: M4CameraInputSnapshot["kind"],
) {
  return sourceKind === "tapo" || sourceKind === "rtsp"
    ? Boolean(
        game.cameraAudio?.[role]?.enabled &&
        game.cameraAudio[role]?.generation !== undefined &&
        game.cameraAudio[role]?.generation ===
          (game.claimGenerations?.[role] ?? 0),
      )
    : cameraAudioEnabled(game, role);
}

/** Only add this intent to a checked private program response, never public data. */
export function nativeCameraAudioIntent(
  game: Pick<GameState, "cameraAudio" | "claimGenerations">,
) {
  return Object.fromEntries(
    (["camera-home", "camera-away"] as const).map((role) => [
      role,
      {
        enabled: Boolean(
          game.cameraAudio?.[role]?.enabled &&
          game.cameraAudio[role]?.generation !== undefined &&
          game.cameraAudio[role]?.generation ===
            (game.claimGenerations?.[role] ?? 0),
        ),
        volume: game.cameraAudio?.[role]?.volume ?? 1,
      },
    ]),
  ) as NonNullable<PrivateProgramGame["nativeCameraAudio"]>;
}

/** Local source selection is authoritative; remote intent cannot select an IP camera. */
export function programCameraAudio(
  game: PrivateProgramGame,
  role: "camera-home" | "camera-away",
  sourceKind: M4CameraInputSnapshot["kind"],
) {
  return sourceKind !== "phone"
    ? game.nativeCameraAudio?.[role]
    : game.cameraAudio?.[role];
}

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
