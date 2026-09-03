import { z } from "zod";
export const gameSchema = z.object({
  eventName: z.string().trim().min(2).max(100),
  homeName: z.string().trim().min(1).max(50),
  awayName: z.string().trim().min(1).max(50),
  homeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  awayColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  scheduledEnds: z.union([z.literal(8), z.literal(10)]),
  initialHammer: z.enum(["home", "away"]),
  youtubeTitle: z.string().trim().min(2).max(100),
  youtubeVisibility: z.enum(["unlisted", "private", "public"]),
});
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("score"),
    team: z.enum(["home", "away"]).nullable(),
    points: z.number().int().min(0).max(8),
    blank: z.boolean(),
  }),
  z.object({ type: z.literal("hammer"), team: z.enum(["home", "away"]) }),
  z.object({ type: z.literal("undo") }),
  z.object({
    type: z.literal("layout"),
    layout: z.enum(["split", "home", "away"]),
  }),
  z.object({ type: z.literal("audio"), muted: z.boolean() }),
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
