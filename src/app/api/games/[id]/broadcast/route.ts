import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readBroadcastSession,
  broadcastStartConfiguration,
  startGameBroadcast,
  stopGameBroadcast,
} from "@/lib/broadcast-session";
import {
  verifiedCompletionAccount,
  type CompletionCredential,
} from "@/lib/game-completion";
import { readAccessToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ action: z.enum(["start", "stop"]) });

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
  });
}

async function credential(
  request: Request,
  gameId: string,
): Promise<CompletionCredential | undefined> {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    try {
      const access = await readAccessToken(bearer);
      if (access.gameId === gameId && access.purpose === "organizer")
        return { kind: "organizer", token: bearer };
    } catch {
      // A stale bearer does not override a valid verified account session.
    }
  }
  const account = await verifiedCompletionAccount();
  return account.ok ? account.value : undefined;
}

function failure(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (code === "42501")
    return response(
      { error: "Broadcast administrator access is required." },
      403,
    );
  if (code === "55000")
    return response(
      {
        error: message.includes("reconnect")
          ? "Reconnect the team YouTube channel before broadcasting."
          : "This game cannot start or resume a broadcast.",
      },
      409,
    );
  return response(
    { error: "Broadcast control is temporarily unavailable." },
    503,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return response({ error: "Invalid game." }, 400);
  const authority = await credential(request, parsed.data.id);
  if (!authority) return failure({ code: "42501" });
  try {
    return response(await readBroadcastSession(parsed.data.id, authority));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !body.success)
    return response({ error: "Invalid broadcast request." }, 400);
  const authority = await credential(request, parsed.data.id);
  if (!authority) return failure({ code: "42501" });
  if (body.data.action === "start" && !broadcastStartConfiguration(request.url))
    return response(
      { error: "Broadcasting is unavailable from this deployment." },
      503,
    );
  try {
    return response(
      body.data.action === "start"
        ? await startGameBroadcast(parsed.data.id, authority)
        : await stopGameBroadcast(parsed.data.id, authority),
    );
  } catch (error) {
    return failure(error);
  }
}
