import { z } from "zod";

export const seasonStatuses = ["draft", "active", "archived"] as const;
export const eventTypes = [
  "tournament",
  "bonspiel",
  "league",
  "playoff",
  "exhibition",
  "other",
] as const;

const calendarDate = z.iso.date();
const trimmedName = (maximum: number) => z.string().trim().min(1).max(maximum);
const validRange = <T extends { startDate: string; endDate: string }>(
  value: T,
) => value.endDate >= value.startDate;

export const seasonInputSchema = z
  .object({
    name: trimmedName(100),
    startDate: calendarDate,
    endDate: calendarDate,
  })
  .refine(validRange, { message: "End date must be on or after start date." });

export function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export const eventInputSchema = z
  .object({
    seasonId: z.uuid(),
    name: trimmedName(150),
    eventType: z.enum(eventTypes),
    startDate: calendarDate,
    endDate: calendarDate,
    location: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(100).refine(isIanaTimezone, {
      message: "Select a valid IANA timezone.",
    }),
  })
  .refine(validRange, { message: "End date must be on or after start date." });

export const opponentInputSchema = z.object({ displayName: trimmedName(100) });
export const scheduledGameInputSchema = z.object({
  seasonId: z.uuid(),
  eventId: z.uuid().nullable(),
  opponentId: z.uuid().nullable(),
  scheduledStart: z.iso.datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(100).refine(isIanaTimezone),
  gameNumber: z.number().int().positive().nullable(),
});

export function normalizeOpponentName(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export type SeasonInput = z.infer<typeof seasonInputSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type OpponentInput = z.infer<typeof opponentInputSchema>;
export type ScheduledGameInput = z.infer<typeof scheduledGameInputSchema>;
export type SeasonStatus = (typeof seasonStatuses)[number];
export type EventType = (typeof eventTypes)[number];

export type Season = SeasonInput & {
  id: string;
  status: SeasonStatus;
  createdAt: string;
  updatedAt: string;
};
export type TeamEvent = EventInput & {
  id: string;
  archivedAt: string | null;
};
export type Opponent = OpponentInput & {
  id: string;
  archivedAt: string | null;
  gamesPlayed: number;
  lastPlayedAt: string | null;
};

export type HierarchyFailure =
  | { kind: "authorization" }
  | { kind: "validation"; issues: z.core.$ZodIssue[] }
  | { kind: "conflict" }
  | { kind: "service" };

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function zonedDateTimeFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function zonedDateTimeParts(
  formatter: Intl.DateTimeFormat,
  instant: number,
): ZonedDateTimeParts {
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as ZonedDateTimeParts;
}

function sameWallTime(parts: ZonedDateTimeParts, expected: ZonedDateTimeParts) {
  return (
    parts.year === expected.year &&
    parts.month === expected.month &&
    parts.day === expected.day &&
    parts.hour === expected.hour &&
    parts.minute === expected.minute
  );
}

/** Format a stored instant for date/time inputs in the explicitly selected zone. */
export function scheduledStartToLocalInput(instant: string, timezone: string) {
  if (!isIanaTimezone(timezone)) return null;
  const timestamp = new Date(instant).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const parts = zonedDateTimeParts(zonedDateTimeFormatter(timezone), timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

/** Convert an intended wall-clock time in an IANA zone to its UTC instant. */
export function localDateTimeToUtc(
  date: string,
  time: string,
  timezone: string,
  preferredInstant?: string | null,
) {
  if (!z.iso.date().safeParse(date).success || !/^\d{2}:\d{2}$/.test(time))
    return null;
  if (!isIanaTimezone(timezone)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  const expected = { year, month, day, hour, minute };
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = zonedDateTimeFormatter(timezone);

  if (preferredInstant) {
    const preferredTimestamp = new Date(preferredInstant).getTime();
    if (
      Number.isFinite(preferredTimestamp) &&
      sameWallTime(zonedDateTimeParts(formatter, preferredTimestamp), expected)
    )
      return new Date(preferredTimestamp).toISOString();
  }

  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = intended + hours * 60 * 60 * 1000;
    const represented = zonedDateTimeParts(formatter, sample);
    offsets.add(
      Date.UTC(
        represented.year,
        represented.month - 1,
        represented.day,
        represented.hour,
        represented.minute,
      ) - sample,
    );
  }
  const candidates = [...offsets]
    .map((offset) => intended - offset)
    .filter((candidate) =>
      sameWallTime(zonedDateTimeParts(formatter, candidate), expected),
    );
  if (!candidates.length) return null; // rejects nonexistent DST wall times
  // A new ambiguous fall-back input consistently chooses the earlier instant.
  return new Date(Math.min(...candidates)).toISOString();
}

export function formatScheduledStart(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}
