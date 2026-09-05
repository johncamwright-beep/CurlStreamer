import { NextResponse } from "next/server";
import { z } from "zod";
import { readGame } from "@/lib/providers/game-read";
import {
  issueLiveKitToken,
  LiveKitConfigurationError,
  terminateGameLiveKit,
  type LiveKitAccess,
} from "@/lib/providers/livekit";
import {
  authorizeGame,
  operatorRoles,
  authorizationError,
} from "@/lib/game-authorization";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/) });

function credentialResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("vary", "Cookie, Authorization");
  return NextResponse.json(body, { ...init, headers });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return credentialResponse({ error: "Invalid game" }, { status: 400 });
  const { id } = parsed.data;
  const publicBroadcast =
    new URL(request.url).searchParams.get("view") === "broadcast";
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) => access.purpose !== "invitation",
  });
  const anonymousBroadcast =
    !authorization.ok &&
    authorization.reason === "unauthorized" &&
    authorization.anonymous &&
    publicBroadcast;
  if (!authorization.ok && !anonymousBroadcast) {
    const failure = authorizationError(authorization);
    return credentialResponse(
      {
        error: failure.error,
        ...(authorization.reason === "released"
          ? { code: "camera_assignment_released" }
          : {}),
      },
      { status: failure.status },
    );
  }
  let role: LiveKitAccess | undefined;
  if (anonymousBroadcast) {
    try {
      const result = await readGame(id);
      if (result.kind !== "active") {
        const failure = authorizationError({
          ok: false,
          reason: result.kind === "completed" ? "closed" : result.kind,
        });
        return credentialResponse(
          { error: failure.error },
          { status: failure.status },
        );
      }
      role = "broadcast-viewer";
    } catch {
      const failure = authorizationError({ ok: false, reason: "unavailable" });
      return credentialResponse(
        { error: failure.error },
        { status: failure.status },
      );
    }
  } else if (authorization.ok) {
    role =
      authorization.via === "account" ||
      authorization.access.purpose === "organizer"
        ? "organizer"
        : authorization.access.role === "camera-home" ||
            authorization.access.role === "camera-away"
          ? authorization.access.role
          : undefined;
  }
  if (!role)
    return credentialResponse({ error: "Access denied" }, { status: 403 });
  try {
    const before = await readGame(id);
    if (before.kind !== "active") {
      const reason = before.kind === "completed" ? "closed" : before.kind;
      const denied = authorizationError({ ok: false, reason });
      return credentialResponse(
        { error: denied.error },
        { status: denied.status },
      );
    }
    const issued = await issueLiveKitToken(id, role);
    // Close the authorization/signing race. A token signed after completion
    // cleanup is never returned, and cleanup is repeated so it cannot reopen a
    // just-deleted room before expiry.
    const after = await readGame(id);
    if (after.kind !== "active") {
      await terminateGameLiveKit(id).catch(() => {});
      const reason = after.kind === "completed" ? "closed" : after.kind;
      const denied = authorizationError({ ok: false, reason });
      return credentialResponse(
        { error: denied.error },
        { status: denied.status },
      );
    }
    return credentialResponse(issued);
  } catch (error) {
    const configuration = error instanceof LiveKitConfigurationError;
    console.error("LiveKit credential service failed", {
      operation: "issue_token",
      category: configuration ? error.category : "signing",
      ...(configuration ? { missingVariables: error.missingVariables } : {}),
    });
    return credentialResponse(
      { error: "Live video is not configured" },
      { status: 503 },
    );
  }
}
