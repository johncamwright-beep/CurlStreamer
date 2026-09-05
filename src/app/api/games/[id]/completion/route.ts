import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeReviewedGame,
  getCompletionCleanup,
  readGameCompletionSummary,
  recordCompletionCleanup,
  reviewGameCompletion,
  verifiedCompletionAccount,
  type CompletionCredential,
} from "@/lib/game-completion";
import { terminateGameLiveKit } from "@/lib/providers/livekit";
import { stopGameBroadcast } from "@/lib/broadcast-session";
import { listCameraIdentityGenerations } from "@/lib/store";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";
import { readAccessToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review"),
    youtubeWatchUrl: z.string().max(500),
  }),
  z.object({ action: z.literal("complete"), reviewId: z.string().uuid() }),
  z.object({ action: z.literal("retry-cleanup") }),
]);

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
      // A stale participant token must not override a valid account session.
    }
  }
  const account = await verifiedCompletionAccount();
  return account.ok ? account.value : undefined;
}

function failure(kind: string) {
  if (kind === "authorization")
    return response(
      { error: "End Game administrator access is required" },
      403,
    );
  if (kind === "conflict")
    return response(
      { error: "The score changed. Review the final score again." },
      409,
    );
  if (kind === "terminal")
    return response(
      { error: "This game cannot be completed from its current state." },
      409,
    );
  return response({ error: "End Game is temporarily unavailable." }, 503);
}

async function cleanup(gameId: string, authority: CompletionCredential) {
  const existing = await getCompletionCleanup(gameId, authority);
  if (existing.ok && existing.value.status === "complete")
    return existing.value;
  const providerErrors: string[] = [];
  try {
    const broadcast = await stopGameBroadcast(gameId, authority);
    if (!["idle", "stopped"].includes(broadcast.status))
      throw new Error("YouTube broadcast shutdown was not confirmed");
  } catch {
    providerErrors.push("YouTube broadcast shutdown was not confirmed");
  }
  try {
    const generations = await listCameraIdentityGenerations(gameId);
    await terminateGameLiveKit(gameId, generations);
  } catch {
    providerErrors.push("LiveKit room shutdown was not confirmed");
  }
  const providerError = providerErrors.join("; ") || undefined;
  const recorded = await recordCompletionCleanup(gameId, authority, {
    succeeded: !providerError,
    error: providerError,
  });
  return recorded.ok
    ? recorded.value
    : {
        status: "failed" as const,
        attempts: 0,
        lastError: providerError ?? "Cleanup status could not be recorded",
      };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return response({ error: "Invalid game" }, 400);
  const authority = await credential(request, parsed.data.id);
  if (!authority) return failure("authorization");
  const result = await getCompletionCleanup(parsed.data.id, authority);
  return result.ok ? response(result.value) : failure(result.kind);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success)
    return response({ error: "Invalid End Game request" }, 400);
  const authority = await credential(request, params.data.id);
  if (!authority) return failure("authorization");
  const gameId = params.data.id;

  if (body.data.action === "review") {
    const watch = youtubeWatchUrlSchema.safeParse(body.data.youtubeWatchUrl);
    if (!watch.success)
      return response(
        { error: "Enter a valid YouTube watch or live link." },
        400,
      );
    const reviewed = await reviewGameCompletion(gameId, authority, watch.data);
    return reviewed.ok ? response(reviewed.value) : failure(reviewed.kind);
  }

  if (body.data.action === "retry-cleanup") {
    const authorized = await getCompletionCleanup(gameId, authority);
    if (!authorized.ok) return failure(authorized.kind);
    return response(await cleanup(gameId, authority));
  }

  const completed = await completeReviewedGame(
    gameId,
    body.data.reviewId,
    authority,
  );
  if (!completed.ok) return failure(completed.kind);
  const cleanupResult = await cleanup(gameId, authority);
  const summary = await readGameCompletionSummary(gameId).catch(
    () => undefined,
  );
  return response({
    completion: summary,
    cleanup: cleanupResult,
    ...(!summary ? { completionSaved: true } : {}),
  });
}
