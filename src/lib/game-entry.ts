import type { GameConfig } from "./types";
import { canonicalTitleFromConfig } from "./game-title";
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
  const number = metadata?.state === "available" ? metadata.gameNumber : null;
  const legacyNumber = config.eventName.match(/\s+[—-]\s+Game\s+(\d+)$/iu)?.[1];
  const gameNumber = number ?? (legacyNumber ? Number(legacyNumber) : null);
  const title = `${canonicalTitleFromConfig(config)}${gameNumber ? ` · Game ${gameNumber}` : ""}`;
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
    : ["owner", "team_admin", "scorer"].includes(accountRole)
      ? accountRole
      : scorer
        ? "scorer"
        : "viewer";
  return gameCapabilities(role, opponentTbd);
}
