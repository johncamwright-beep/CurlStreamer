import React from "react";
import { ProgramUsbAudio } from "@/components/ProgramUsbAudio";
import { ProgramPhoneAudio } from "@/components/ProgramPhoneAudio";
import type { PrivateProgramGame } from "../game-projection";
import type { M4CameraInputSnapshot } from "../m4-camera-input";
import { programCameraAudio } from "../camera-audio";

const roles = ["camera-home", "camera-away"] as const;
export function M4ProgramAudio({
  game,
  sources,
  phoneStreams,
}: {
  game: PrivateProgramGame;
  sources?: Record<(typeof roles)[number], M4CameraInputSnapshot>;
  phoneStreams: Partial<Record<(typeof roles)[number], MediaStream>>;
}) {
  return (
    <>
      <ProgramUsbAudio
        delayMs={
          game.programAudioDelayMs ??
          (sources &&
          roles.some(
            (role) =>
              sources[role].kind !== "phone" &&
              sources[role].connectionEnabled !== false,
          )
            ? 1000
            : 0)
        }
      />
      {sources &&
        roles
          .filter((role) => sources[role].kind !== "phone")
          .map((role) => (
            <ProgramUsbAudio
              key={role}
              endpoint={`/ip-camera/${role}/audio?generation=${sources[role].generation}&after=0`}
              generationHeader="x-m4-ip-camera-generation"
              role={role}
              sourceGeneration={sources[role].generation}
              enabled={
                programCameraAudio(game, role, sources[role].kind)?.enabled ===
                true
              }
              volume={
                programCameraAudio(game, role, sources[role].kind)?.volume ?? 1
              }
            />
          ))}
      {roles.map((role) => (
        <ProgramPhoneAudio
          key={role}
          role={role}
          stream={
            sources?.[role].kind === "phone" ? phoneStreams[role] : undefined
          }
          sourceGeneration={sources?.[role].generation}
          enabled={programCameraAudio(game, role, "phone")?.enabled === true}
          volume={programCameraAudio(game, role, "phone")?.volume ?? 1}
        />
      ))}
    </>
  );
}
