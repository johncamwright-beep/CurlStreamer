"use client";
import React from "react";
import type { GameState } from "@/lib/types";
import type { BroadcastGame } from "@/lib/game-projection";
import { isScorerAudioEffectivelyMuted } from "@/lib/sponsor-audio";
import { LiveKitCameraFeed } from "./LiveKitCameraFeed";
import { ProgramComposition } from "./ProgramCanvas";

export function BroadcastCanvas({ game }: { game: GameState | BroadcastGame }) {
  return (
    <ProgramComposition
      game={game}
      statusLabel={game.broadcast.toUpperCase()}
      audioStatus={
        isScorerAudioEffectivelyMuted(game)
          ? "Audio muted"
          : "Scorer audio live"
      }
      renderCamera={(role) => (
        <LiveKitCameraFeed
          gameId={game.id}
          role={role}
          framing={game.cameraFraming?.[role] ?? "fill"}
          showPlaceholderGuides
        />
      )}
    />
  );
}
