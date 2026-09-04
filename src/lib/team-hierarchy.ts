import { z } from "zod";

export const seasonStatuses = ["draft", "active", "archived"] as const;
export const eventTypes = [
  "tournament",
  "bonspiel",
  "league",
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
  eventId: z.uuid(),
  opponentId: z.uuid(),
  scheduledStart: z.iso.datetime({ offset: true }),
  gameNumber: z.number().int().positive(),
  gameLabel: z.string().trim().min(1).max(100).optional(),
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

/** Convert an intended wall-clock time in an IANA zone to its UTC instant. */
export function localDateTimeToUtc(
  date: string,
  time: string,
  timezone: string,
) {
  if (!z.iso.date().safeParse(date).success || !/^\d{2}:\d{2}$/.test(time))
    return null;
  if (!isIanaTimezone(timezone)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  const partsFor = (instant: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  let instant = intended;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const p = partsFor(instant);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    instant += intended - represented;
  }
  const p = partsFor(instant);
  if (
    p.year !== year ||
    p.month !== month ||
    p.day !== day ||
    p.hour !== hour ||
    p.minute !== minute
  )
    return null; // rejects nonexistent DST wall times
  return new Date(instant).toISOString();
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
