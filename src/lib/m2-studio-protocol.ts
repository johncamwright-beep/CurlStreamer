import { z } from "zod";
import { signalSchema, studioSideSchema } from "./studio-protocol";
export {
  signalSchema,
  studioSideSchema,
  signalAllowed,
  hostCandidate,
} from "./studio-protocol";
export type { StudioSide, StudioSignal } from "./studio-protocol";

export const cameraRoleSchema = z.enum(["camera-home", "camera-away"]);
export type CameraRole = z.infer<typeof cameraRoleSchema>;
export const studioRequestSchema = z
  .object({
    cameraRole: cameraRoleSchema,
    action: z.enum(["register", "begin", "ticket", "check", "stop", "signal"]),
    side: studioSideSchema,
    sessionId: z.uuid().optional(),
    negotiationId: z.uuid().optional(),
    signal: signalSchema.optional(),
  })
  .strict();
export const studioTicketSchema = z.object({
  cameraRole: cameraRoleSchema,
  sessionId: z.uuid(),
  generation: z.number().int().positive(),
  negotiationId: z.uuid().nullable(),
  assignmentGeneration: z.number().int().nonnegative().nullable(),
  expiresAt: z.number(),
  // Application clock, shared with signaling expiry; never the device clock.
  serverTime: z.number().finite().optional(),
  topic: z.string().optional(),
  token: z.string().optional(),
});
export type StudioTicket = z.infer<typeof studioTicketSchema>;
export const signalEnvelopeSchema = z
  .object({
    cameraRole: cameraRoleSchema,
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
