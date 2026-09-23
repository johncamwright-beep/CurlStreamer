import { z } from "zod";

export const studioSideSchema = z.enum(["receiver", "camera"]);
export type StudioSide = z.infer<typeof studioSideSchema>;
export const signalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }).strict(),
  z.object({ type: z.literal("path-confirmed") }).strict(),
  z
    .object({
      type: z.enum(["offer", "answer"]),
      sdp: z.string().min(1).max(32768),
    })
    .strict(),
  z
    .object({
      type: z.literal("ice"),
      candidate: z
        .object({
          candidate: z.string().min(1).max(2048),
          sdpMid: z.string().max(64).nullable(),
          sdpMLineIndex: z.number().int().min(0).max(8).nullable(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type StudioSignal = z.infer<typeof signalSchema>;
export const studioRequestSchema = z
  .object({
    action: z.enum(["register", "begin", "ticket", "check", "stop", "signal"]),
    side: studioSideSchema,
    sessionId: z.uuid().optional(),
    negotiationId: z.uuid().optional(),
    signal: signalSchema.optional(),
  })
  .strict();
export const studioTicketSchema = z.object({
  sessionId: z.uuid(),
  generation: z.number().int().positive(),
  negotiationId: z.uuid().nullable(),
  assignmentGeneration: z.number().int().nonnegative().nullable(),
  expiresAt: z.number(),
  topic: z.string().optional(),
  token: z.string().optional(),
});
export type StudioTicket = z.infer<typeof studioTicketSchema>;
export const signalEnvelopeSchema = z
  .object({
    sessionId: z.uuid(),
    negotiationId: z.uuid(),
    generation: z.number().int().positive(),
    assignmentGeneration: z.number().int().nonnegative(),
    from: studioSideSchema,
    messageId: z.uuid(),
    expiresAt: z.number(),
    signal: signalSchema,
  })
  .strict();

/** Host-only signaling is checked before WebRTC sees any remote candidates. */
export function hostCandidate(candidate: string) {
  return /^candidate:[^\s]+ \d+ (udp|tcp) \d+ [^\s]+ \d+ typ host(?: |$)/i.test(
    candidate,
  );
}
export function signalAllowed(side: StudioSide, signal: StudioSignal) {
  if (signal.type === "ready") return side === "camera";
  if (signal.type === "path-confirmed") return side === "receiver";
  if (signal.type === "ice") return hostCandidate(signal.candidate.candidate);
  if ((signal.type === "offer") !== (side === "receiver")) return false;
  return signal.sdp
    .split(/\r?\n/)
    .every(
      (line) =>
        !line.startsWith("a=candidate:") || hostCandidate(line.slice(2)),
    );
}
