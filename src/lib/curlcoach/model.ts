import { z } from "zod";
import { videoReviewSchema } from "./review";

export const organizationId = "curlcoach-synthetic-org";
export const gameId = "curlcoach-synthetic-game";
export const roster = [
  { id: "lead", name: "Alex (Lead)", position: "Lead" },
  { id: "second", name: "Blair (Second)", position: "Second" },
  { id: "third", name: "Casey (Third)", position: "Third" },
  { id: "fourth", name: "Drew (Fourth)", position: "Fourth" },
  { id: "alternate", name: "Ellis (Alternate)" },
] as const;
export const shotTypes = [
  "Guard/Front Stone",
  "Draw",
  "Come Around",
  "Angle/Freeze",
  "Tap/Split",
  "Hit & Stay",
  "Hit & Roll",
  "Finesse Hit",
  "Peel",
  "Runback/Multiple",
] as const;
export const turns = [
  "CW C",
  "CW S",
  "CCW C",
  "CCW S",
  "CW C IO",
  "CW S IO",
  "CCW C IO",
  "CCW S IO",
] as const;
export const executions = ["Make", "Partial", "Limited", "Xmiss"] as const;
export const deficiencies = [
  "Make",
  "Light",
  "Heavy",
  "Undercurl",
  "Overcurl",
  "Management",
] as const;
export const reviews = ["Team", "Player", "Strategy", "Highlight"] as const;
export const exclusions = ["Pick", "Burnt rock", "Throw-through"] as const;
export const shotSchema = z
  .object({
    playerId: z.string().min(1).max(100),
    position: z.enum(["Lead", "Second", "Third", "Fourth"]),
    end: z.number().int().min(1).max(20),
    stone: z.number().int().min(1).max(2),
    type: z.enum(shotTypes).nullable(),
    turn: z.enum(turns).nullable(),
    execution: z.enum(executions).nullable(),
    grade: z.number().int().min(0).max(5).nullable(),
    deficiency: z.enum(deficiencies).nullable(),
    review: z.enum(reviews).nullable(),
    excluded: z.enum(exclusions).nullable(),
    note: z.string().trim().max(1000),
    flagged: z.boolean().optional(),
    flaggedAt: z.string().datetime().optional(),
    videoReview: videoReviewSchema.optional(),
  })
  .strict()
  .superRefine((shot, ctx) => {
    if (shot.excluded && shot.grade !== null)
      ctx.addIssue({
        code: "custom",
        message: "Excluded attempts cannot have a numeric grade.",
      });
    if (shot.grade !== null && !shot.type)
      ctx.addIssue({
        code: "custom",
        message: "Choose one shot type for a graded attempt.",
      });
  });
export type Shot = z.infer<typeof shotSchema>;
export const commandSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    shotId: z.string().uuid(),
    shot: shotSchema.nullable(),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export const rosterEntrySchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    position: z.enum(["Lead", "Second", "Third", "Fourth"]).optional(),
  })
  .strict();
export type RosterEntry = z.infer<typeof rosterEntrySchema>;
export const lifecycleSchema = z
  .object({
    action: z.enum(["finish", "reopen"]),
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type ShotEvent = Command & {
  revision: number;
  at: string;
  actor: string;
};
export type State = {
  organizationId: string;
  gameId: string;
  profile: "tracker-provisional-v1";
  events: ShotEvent[];
  /** Present on private persisted sessions; optional for legacy sample fixtures. */
  revision?: number;
  status?: "open" | "closed";
  roster?: RosterEntry[];
};
export const stateSchema = z
  .object({
    organizationId: z.string().min(1),
    gameId: z.string().min(1),
    profile: z.literal("tracker-provisional-v1"),
    events: z.array(
      commandSchema.extend({
        revision: z.number().int().positive(),
        at: z.string().datetime(),
        actor: z.string().min(1),
      }),
    ),
    revision: z.number().int().nonnegative().optional(),
    status: z.enum(["open", "closed"]).optional(),
    roster: z.array(rosterEntrySchema).optional(),
  })
  .strict();
export function emptyState(): State {
  return {
    organizationId,
    gameId,
    profile: "tracker-provisional-v1",
    events: [],
    revision: 0,
    status: "open",
    roster: [...roster],
  };
}
export function currentShots(events: ShotEvent[]) {
  const shots = new Map<string, Shot>();
  for (const event of events) {
    if (event.shot) shots.set(event.shotId, event.shot);
    else shots.delete(event.shotId);
  }
  return [...shots].map(([id, shot]) => ({ id, ...shot }));
}
export function append(state: State, command: Command, actor: string): State {
  const previous = state.events.find((e) => e.requestId === command.requestId);
  if (previous) {
    if (
      JSON.stringify({
        expectedRevision: previous.expectedRevision,
        shotId: previous.shotId,
        shot: previous.shot,
      }) !==
      JSON.stringify({
        expectedRevision: command.expectedRevision,
        shotId: command.shotId,
        shot: command.shot,
      })
    )
      throw new Error("Request ID already used");
    return state;
  }
  const revision = state.revision ?? state.events.length;
  if (revision !== command.expectedRevision)
    throw new Error("Report changed. Reload before correcting it.");
  const shots = currentShots(state.events);
  if (!command.shot && !shots.some((s) => s.id === command.shotId))
    throw new Error("Attempt not found");
  if (
    command.shot &&
    shots.some(
      (s) =>
        s.id !== command.shotId &&
        s.end === command.shot!.end &&
        s.position === command.shot!.position &&
        s.stone === command.shot!.stone,
    )
  )
    throw new Error(
      "This position and stone already has an attempt in that end. Correct it instead.",
    );
  return {
    ...state,
    events: [
      ...state.events,
      {
        ...command,
        actor,
        revision: revision + 1,
        at: new Date().toISOString(),
      },
    ],
    revision: revision + 1,
  };
}
export function report(shots: Shot[]) {
  let scored = 0;
  let points = 0;
  let missing = 0;
  let excluded = 0;
  for (const shot of shots) {
    if (shot.excluded) {
      excluded++;
    } else if (shot.grade === null) {
      missing++;
    } else {
      scored++;
      points += shot.grade;
    }
  }
  return {
    attempts: shots.length,
    scored,
    missing,
    excluded,
    percent: scored ? (points / (5 * scored)) * 100 : null,
  };
}
