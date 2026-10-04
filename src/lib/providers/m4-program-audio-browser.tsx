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
      <ProgramUsbAudio />
      {sources &&
        roles
          .filter((role) => sources[role].kind === "tapo")
          .map((role) => (
            <ProgramUsbAudio
              key={role}
              endpoint={`/ip-camera/${role}/audio?generation=${sources[role].generation}&after=0`}
              generationHeader="x-m4-ip-camera-generation"
              role={role}
              sourceGeneration={sources[role].generation}
              enabled={programCameraAudio(game, role, "tapo")?.enabled === true}
              volume={programCameraAudio(game, role, "tapo")?.volume ?? 1}
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
