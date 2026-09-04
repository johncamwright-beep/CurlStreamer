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
