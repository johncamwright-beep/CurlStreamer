import "server-only";
import { SignJWT } from "jose";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  studioTicketSchema,
  type StudioSide,
  type StudioTicket,
  type studioRequestSchema,
} from "@/lib/studio-protocol";
import type { z } from "zod";

export class StudioUnavailable extends Error {}
export class StudioRejected extends Error {}
export function requireStudioConfiguration() {
  // No implicit local-store mock and no production enablement during M1.
  if (
    process.env.CURLCAST_M1_DIRECT_SPIKE !== "disposable" ||
    process.env.NODE_ENV !== "production" ||
    (process.env.SUPABASE_JWT_SECRET?.length ?? 0) < 32
  )
    throw new StudioUnavailable();
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
    "m1_studio_action",
    {
      p_game_id: gameId,
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
      throw new StudioRejected();
    throw new StudioUnavailable();
  }
  const parsed = studioTicketSchema.safeParse(data);
  if (!parsed.success) throw new StudioUnavailable();
  return parsed.data;
}
export function studioTopic(ticket: StudioTicket, side: StudioSide) {
  return [
    "m1",
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
    m1_game: gameId,
    m1_session: ticket.sessionId,
    m1_generation: ticket.generation,
    m1_assignment: ticket.assignmentGeneration,
    m1_negotiation: ticket.negotiationId,
    m1_side: side,
    m1_topic: topic,
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
      "m1-signal",
      {
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
    if (!outcome.success) throw new StudioUnavailable();
  } finally {
    await db.removeChannel(channel);
  }
}
