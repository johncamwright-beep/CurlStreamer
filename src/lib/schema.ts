import { z } from "zod";
export const gameSchema = z.object({
  eventName: z.string().trim().min(2).max(100),
  homeName: z.string().trim().min(1).max(50),
  awayName: z.string().trim().min(1).max(50),
  homeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  awayColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  scheduledEnds: z.union([z.literal(8), z.literal(10)]),
  youtubeTitle: z.string().trim().min(2).max(100),
  youtubeVisibility: z.enum(["unlisted", "private", "public"]),
});
const scoringIntent = {
  intentId: z.uuid(),
  expectedLastEventId: z.string().min(1).max(100).nullable(),
  expectedEnd: z.number().int().positive().max(100),
};
const scoreActionSchema = z
  .object({
    type: z.literal("score"),
    ...scoringIntent,
    team: z.enum(["home", "away"]).nullable(),
    points: z.number().int().min(0).max(8),
    blank: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.blank && (value.points !== 0 || value.team !== null))
      context.addIssue({
        code: "custom",
        message: "A blank end cannot include points or a scoring team.",
      });
    if (!value.blank && (value.points < 1 || value.team === null))
      context.addIssue({
        code: "custom",
        message: "A scored end requires a team and one or more points.",
      });
  });
export const actionSchema = z.discriminatedUnion("type", [
  scoreActionSchema,
  z.object({
    type: z.literal("hammer"),
    ...scoringIntent,
    team: z.enum(["home", "away"]),
  }),
  z.object({
    type: z.literal("undo"),
    intentId: z.uuid(),
    expectedLastEventId: z.string().min(1).max(100).nullable(),
    expectedTargetId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal("layout"),
    layout: z.enum(["split", "home", "away", "none"]),
  }),
  z.object({ type: z.literal("audio"), muted: z.boolean() }),
  z.object({
    type: z.literal("camera-audio"),
    role: z.enum(["camera-home", "camera-away"]),
    enabled: z.boolean(),
    volume: z.number().finite().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("camera-audio-status"),
    role: z.enum(["camera-home", "camera-away"]),
    status: z.enum([
      "off",
      "pending",
      "active",
      "permission-required",
      "error",
    ]),
  }),
  z.object({
    type: z.literal("camera-zoom"),
    role: z.enum(["camera-home", "camera-away"]),
    commandId: z.uuid(),
    value: z.number().finite().min(0).max(100),
  }),
  z
    .object({
      type: z.literal("camera-zoom-status"),
      role: z.enum(["camera-home", "camera-away"]),
      supported: z.boolean(),
      min: z.number().finite().min(0).max(100).optional(),
      max: z.number().finite().min(0).max(100).optional(),
      step: z.number().finite().positive().max(100).optional(),
      value: z.number().finite().min(0).max(100).optional(),
    })
    .superRefine((value, context) => {
      if (!value.supported) return;
      if (
        value.min === undefined ||
        value.max === undefined ||
        value.step === undefined ||
        value.value === undefined ||
        value.max <= value.min ||
        value.value < value.min ||
        value.value > value.max
      )
        context.addIssue({
          code: "custom",
          message:
            "A supported camera must report a valid hardware zoom range.",
        });
    }),
  z.object({
    type: z.literal("camera-framing"),
    role: z.enum(["camera-home", "camera-away"]),
    mode: z.enum(["fill", "contain"]),
  }),
  z.object({ type: z.literal("broadcast"), value: z.enum(["idle", "live"]) }),
  z.object({ type: z.literal("close-game") }),
  z.object({
    type: z.literal("connection"),
    role: z.enum(["camera-home", "camera-away", "scorer"]),
    connected: z.boolean(),
  }),
  z.object({
    type: z.literal("camera-health"),
    role: z.enum(["camera-home", "camera-away"]),
    phase: z.enum([
      "connecting",
      "live",
      "reconnecting",
      "disconnected",
      "attention",
    ]),
    diagnostic: z.string().trim().max(160).optional(),
  }),
  z.object({
    type: z.literal("sponsor-mode"),
    active: z.boolean(),
    style: z.enum(["fullscreen", "overlay"]).optional(),
    intervalSeconds: z.number().int().min(3).max(10).optional(),
  }),
  z.object({
    type: z.literal("sponsor-nav"),
    direction: z.union([z.literal(-1), z.literal(1)]).optional(),
    paused: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("sponsors"),
    sponsors: z
      .array(
        z.object({
          id: z.string(),
          name: z.string().max(100),
          dataUrl: z.string().max(2_000_000),
          enabled: z.boolean(),
          rotation: z.number().int(),
        }),
      )
      .max(100),
  }),
]);

export function hasSafeSponsorContent(dataUrl: string) {
  if (dataUrl === "/sponsors/community.svg" || dataUrl === "/sponsors/rock.svg")
    return true;
  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match) return false;
  const bytes = Buffer.from(match[2], "base64");
  if (match[1] === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (match[1] === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
