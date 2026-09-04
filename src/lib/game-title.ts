import type { GameConfig } from "@/lib/types";

export function normalizeTitleWhitespace(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, " ") ?? "";
}

export type GameTitleParts = {
  homeName?: string | null;
  awayName?: string | null;
  eventName?: string | null;
  legacyTitle?: string | null;
  structured?: boolean;
};

/** Formats a title exclusively from the participant and event snapshots. */
export function formatCanonicalGameTitle(parts: GameTitleParts) {
  if (parts.structured === false) {
    const legacy = normalizeTitleWhitespace(parts.legacyTitle);
    if (legacy) return legacy;
  }
  const home = normalizeTitleWhitespace(parts.homeName) || "TBD";
  const awayValue = normalizeTitleWhitespace(parts.awayName);
  const away = !awayValue || awayValue === "Opponent TBD" ? "TBD" : awayValue;
  const event = normalizeTitleWhitespace(parts.eventName);
  return `${home} vs ${away}${event ? ` — ${event}` : ""}`;
}

export function canonicalTitleFromConfig(
  config: GameConfig,
  eventName: string | null = config.eventName === "Single Game"
    ? null
    : config.eventName,
) {
  const canonicalEvent = eventName?.replace(/\s+[—-]\s+Game\s+\d+$/iu, "");
  return formatCanonicalGameTitle({
    homeName: config.homeName,
    awayName: config.awayName,
    eventName: canonicalEvent,
  });
}

export function formatBroadcastRailTitle(eventName?: string | null) {
  return normalizeTitleWhitespace(eventName) || "Single Game";
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
