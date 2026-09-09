import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeGame, authorizationError } from "@/lib/game-authorization";
import { studioRequestSchema, signalAllowed } from "@/lib/m2-studio-protocol";
import {
  requireStudioConfiguration,
  studioAction,
  issueStudioTicket,
  broadcastStudioSignal,
  StudioRejected,
} from "@/lib/providers/m2-studio-session";

export const dynamic = "force-dynamic";
function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const game = z.uuid().safeParse((await params).id);
  if (!game.success) return response({ error: "Invalid game" }, 400);
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 40_000)
      return response({ error: "Signaling request too large" }, 413);
    input = studioRequestSchema.safeParse(JSON.parse(raw));
  } catch {
    return response({ error: "Invalid studio request" }, 400);
  }
  if (!input.success) return response({ error: "Invalid studio request" }, 400);
  const body = input.data;
  if (
    ((body.action === "register" || body.action === "stop") &&
      body.side !== "receiver") ||
    (body.action === "begin" && body.side !== "camera") ||
    (body.action === "signal" &&
      (!body.signal ||
        !body.sessionId ||
        !body.negotiationId ||
        !signalAllowed(body.side, body.signal)))
  )
    return response({ error: "Invalid studio action" }, 400);
  try {
    requireStudioConfiguration();
    const authorization = await authorizeGame(request, game.data, {
      accountRoles: body.side === "receiver" ? ["owner", "team_admin"] : [],
      tokenAllowed: (access) =>
        body.side === "receiver"
          ? access.purpose === "organizer"
          : access.purpose === "participant" && access.role === body.cameraRole,
    });
    if (!authorization.ok) {
      const failure = authorizationError(authorization);
      return response({ error: failure.error }, failure.status);
    }
    if (
      body.side === "camera" &&
      (authorization.via !== "token" ||
        authorization.access.purpose !== "participant" ||
        authorization.access.role !== body.cameraRole ||
        !authorization.access.deviceId)
    )
      return response({ error: "Current camera slot claim required" }, 403);
    const authority =
      authorization.via === "account"
        ? { organizationId: authorization.organizationId }
        : body.side === "camera"
          ? {
              deviceId: authorization.access.deviceId,
              assignmentGeneration:
                authorization.access.assignmentGeneration ?? 0,
            }
          : {};
    const ticket = await studioAction(game.data, body, authority);
    if (body.action === "signal") {
      await broadcastStudioSignal(ticket, body.side, body.signal);
      // Recheck after the external send; clients also check before applying each message.
      await studioAction(game.data, { ...body, action: "check" }, authority);
      return response({ ok: true });
    }
    if (body.action === "begin" || body.action === "ticket")
      return response(await issueStudioTicket(game.data, ticket, body.side));
    return response(ticket);
  } catch (cause) {
    return cause instanceof StudioRejected
      ? response(
          {
            error:
              "Studio or camera authority expired. Reconnect from the current session.",
          },
          409,
        )
      : response(
          {
            error: "M2 requires configured disposable Supabase infrastructure.",
          },
          503,
        );
  }
}
