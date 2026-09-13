import "server-only";
import { SignJWT } from "jose";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  studioTicketSchema,
  type StudioSide,
  type StudioTicket,
  type studioRequestSchema,
} from "@/lib/m2-studio-protocol";
import type { z } from "zod";

export class StudioUnavailable extends Error {
  constructor(
    readonly stage:
      "configuration" | "database" | "ticket" | "broadcast" = "configuration",
    readonly databaseCode?: string,
  ) {
    super("Studio service unavailable");
  }
}
export class StudioRejected extends Error {
  constructor(
    readonly reason:
      | "studio_stale"
      | "peer_stale"
      | "camera_released"
      | "signal_limit"
      | "unknown" = "unknown",
  ) {
    super("Studio authority rejected");
  }
}
export function studioRejectionReason(
  message: string,
): StudioRejected["reason"] {
  return message === "studio_stale" ||
    message === "peer_stale" ||
    message === "camera_released" ||
    message === "signal_limit"
    ? message
    : "unknown";
}
export function requireStudioConfiguration() {
  // Reuse the explicit disposable-pilot gate; never enable an implicit mock.
  if (
    process.env.CURLCAST_M1_DIRECT_SPIKE !== "disposable" ||
    process.env.NODE_ENV !== "production" ||
    (process.env.SUPABASE_JWT_SECRET?.length ?? 0) < 32
  )
    throw new StudioUnavailable("configuration");
}
export async function studioAction(
  gameId: string,
  input: z.infer<typeof studioRequestSchema>,
  authority: {
    deviceId?: string;
    assignmentGeneration?: number;
    organizationId?: string;
  },
) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "m2_studio_action",
    {
      p_game_id: gameId,
      p_camera_role: input.cameraRole,
      p_action: input.action,
      p_side: input.side,
      p_session_id: input.sessionId ?? null,
      p_negotiation_id: input.negotiationId ?? null,
      p_device_id: authority.deviceId ?? null,
      p_assignment_generation: authority.assignmentGeneration ?? null,
      p_organization_id: authority.organizationId ?? null,
    },
  );
  if (error) {
    if (["55000", "42501", "54000", "22023"].includes(error.code))
      throw new StudioRejected(studioRejectionReason(error.message));
    throw new StudioUnavailable(
      "database",
      /^[A-Z0-9]{5,9}$/.test(error.code) ? error.code : undefined,
    );
  }
  const parsed = studioTicketSchema.safeParse(data);
  if (!parsed.success || parsed.data.cameraRole !== input.cameraRole)
    throw new StudioUnavailable("ticket");
  return { ...parsed.data, serverTime: Date.now() };
}
export function studioTopic(ticket: StudioTicket, side: StudioSide) {
  return [
    "m2",
    ticket.cameraRole,
    ticket.sessionId,
    ticket.generation,
    ticket.negotiationId,
    side,
  ].join(":");
}
export async function issueStudioTicket(
  gameId: string,
  ticket: StudioTicket,
  side: StudioSide,
) {
  if (!ticket.negotiationId || ticket.assignmentGeneration === null)
    throw new StudioRejected();
  const topic = studioTopic(ticket, side);
  const token = await new SignJWT({
    role: "authenticated",
    m2_game: gameId,
    m2_camera_role: ticket.cameraRole,
    m2_session: ticket.sessionId,
    m2_generation: ticket.generation,
    m2_assignment: ticket.assignmentGeneration,
    m2_negotiation: ticket.negotiationId,
    m2_side: side,
    m2_topic: topic,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("authenticated")
    .setSubject(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(ticket.expiresAt / 1000))
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
  return { ...ticket, topic, token };
}
export async function broadcastStudioSignal(
  ticket: StudioTicket,
  side: StudioSide,
  signal: unknown,
) {
  // REST broadcast is ephemeral: unlike realtime.send(), it stores no SDP/ICE rows.
  const db = createAdminSupabaseClient();
  const channel = db.channel(
    studioTopic(ticket, side === "camera" ? "receiver" : "camera"),
    { config: { private: true } },
  );
  try {
    const outcome = await channel.httpSend(
      "m2-signal",
      {
        cameraRole: ticket.cameraRole,
        sessionId: ticket.sessionId,
        generation: ticket.generation,
        negotiationId: ticket.negotiationId,
        assignmentGeneration: ticket.assignmentGeneration,
        from: side,
        messageId: crypto.randomUUID(),
        expiresAt: Date.now() + 10_000,
        signal,
      },
      { timeout: 5_000 },
    );
    if (!outcome.success) throw new StudioUnavailable("broadcast");
  } finally {
    await db.removeChannel(channel);
  }
}
