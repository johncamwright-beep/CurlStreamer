import type { GameConfig } from "./types";
import { canonicalTitleFromConfig, formatEventGameLabel } from "./game-title";
import { formatScheduledStart } from "./team-hierarchy";
import { gameCapabilities } from "./current-game";

export type GameNavigationMetadata =
  | {
      state: "available";
      scheduledStart: string | null;
      timezone: string | null;
      gameNumber: number | null;
    }
  | { state: "unavailable" };

export function gameEntryPresentation(
  config: Pick<GameConfig, "eventName" | "homeName" | "awayName">,
  metadata?: GameNavigationMetadata,
) {
  const title = canonicalTitleFromConfig({
    ...config,
    eventName: formatEventGameLabel(
      config.eventName,
      metadata?.state === "available" ? metadata.gameNumber : undefined,
    ),
  });
  let scheduledLabel = "Schedule unavailable";
  if (metadata?.state === "available") {
    if (metadata.scheduledStart === null) scheduledLabel = "Unscheduled";
    else if (metadata.timezone) {
      try {
        scheduledLabel = `${formatScheduledStart(metadata.scheduledStart, metadata.timezone)} · ${metadata.timezone}`;
      } catch {
        /* An unreadable schedule must not become an invented time. */
      }
    }
  }
  return { title, scheduledLabel };
}

export function gameEntryCapabilities(
  accountRole: string,
  organizer: boolean,
  scorer: boolean,
  opponentTbd: boolean,
) {
  const role = organizer
    ? "organizer"
    : ["owner", "team_admin", "game_operator", "scorer"].includes(accountRole)
      ? accountRole
      : scorer
        ? "scorer"
        : "viewer";
  return gameCapabilities(role, opponentTbd);
}
