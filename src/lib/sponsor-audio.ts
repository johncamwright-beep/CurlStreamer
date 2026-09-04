import type { GameState } from "./types";
import type { BroadcastGame } from "./game-projection";

export function hasVisibleSponsorOverlay(game: GameState | BroadcastGame) {
  return (
    game.sponsorMode.active &&
    game.sponsorMode.style === "overlay" &&
    game.sponsors.some((sponsor) => sponsor.enabled)
  );
}

export function isScorerAudioEffectivelyMuted(game: GameState | BroadcastGame) {
  const manualMute = game.audioMuted;
  const visibleSponsorOverlay = hasVisibleSponsorOverlay(game);

  // Sidebar rotation is deliberately excluded from the effective audio state.
  return manualMute || visibleSponsorOverlay;
}
