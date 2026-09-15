import type { GameConfig } from "@/lib/types";

export function normalizeTitleWhitespace(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, " ") ?? "";
}

export type GameTitleParts = {
  homeName?: string | null;
  awayName?: string | null;
  eventName?: string | null;
  gameNumber?: number | null;
  legacyTitle?: string | null;
  structured?: boolean;
};

export function formatEventGameLabel(
  eventName?: string | null,
  gameNumber?: number | null,
) {
  const name = normalizeTitleWhitespace(eventName);
  const legacy = name.match(/\s+[—·-]\s+Game\s+(\d+)$/iu);
  const base = name.replace(/\s+[—·-]\s+Game\s+\d+$/iu, "");
  const number =
    gameNumber === undefined ? (legacy ? Number(legacy[1]) : null) : gameNumber;
  return number && Number.isInteger(number) && number > 0
    ? `${base}${base ? " · " : ""}Game ${number}`
    : base;
}

/** Formats a title exclusively from the participant and event snapshots. */
export function formatCanonicalGameTitle(parts: GameTitleParts) {
  if (parts.structured === false) {
    const legacy = normalizeTitleWhitespace(parts.legacyTitle);
    if (legacy) return legacy;
  }
  const home = normalizeTitleWhitespace(parts.homeName) || "TBD";
  const awayValue = normalizeTitleWhitespace(parts.awayName);
  const away = !awayValue || awayValue === "Opponent TBD" ? "TBD" : awayValue;
  const event = formatEventGameLabel(parts.eventName, parts.gameNumber);
  return `${home} vs ${away}${event ? ` — ${event}` : ""}`;
}

export function canonicalTitleFromConfig<
  T extends Pick<GameConfig, "eventName" | "homeName" | "awayName">,
>(
  config: T,
  eventName: string | null = config.eventName === "Single Game"
    ? null
    : config.eventName,
) {
  const canonicalEvent = formatEventGameLabel(eventName);
  return formatCanonicalGameTitle({
    homeName: config.homeName,
    awayName: config.awayName,
    eventName: canonicalEvent,
  });
}

export function formatBroadcastRailTitle(eventName?: string | null) {
  const title = normalizeTitleWhitespace(eventName);
  return /^single game$/i.test(title) ? "" : title;
}

export function formatYouTubeScheduledTitle(
  canonicalTitle: string,
  scheduledStart?: string | null,
  timezone?: string | null,
) {
  const title = normalizeTitleWhitespace(canonicalTitle);
  if (!scheduledStart || !timezone) return title;
  const date = new Date(scheduledStart);
  if (Number.isNaN(date.getTime())) return title;
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
    const zone = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
    return `${title} — ${formatted} ${zone ?? timezone}`;
  } catch {
    return title;
  }
}
