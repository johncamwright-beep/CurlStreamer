import { NextResponse } from "next/server";
import { z } from "zod";
import {
  verifiedCompletionAccount,
  type CompletionCredential,
} from "@/lib/game-completion";
import { readAccessToken } from "@/lib/tokens";
import { participantUrl } from "@/lib/participant-links";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";
import {
  readM4Session,
  prepareM4Session,
  stopM4Session,
  m4Configuration,
  goLiveM4Session,
} from "@/lib/providers/m4-youtube-session";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.uuid() }).strict();
const bodySchema = z
  .object({ action: z.enum(["prepare", "stop", "go-live"]) })
  .strict();
const safeSessionSchema = z.object({
  phase: z
    .enum([
      "ended",
      "removed",
      "live",
      "reconnecting",
      "starting",
      "setup-required",
      "stream-error",
      "waiting-video",
      "unknown",
    ])
    .optional(),
  desiredState: z.enum(["live", "stopped"]),
  status: z.enum([
    "idle",
    "preparing",
    "prepared",
    "stopping",
    "stopped",
    "failed",
  ]),
  lastErrorCode: z
    .enum([
      "youtube_reconnect_required",
      "broadcast_operation_uncertain",
      "broadcast_discovery_incomplete",
      "youtube_manual_configuration_mismatch",
      "youtube_broadcast_terminal",
      "m4_provider_unavailable",
      "m4_operation_fenced",
    ])
    .optional()
    .catch(undefined),
  watchUrl: youtubeWatchUrlSchema
    .transform((value) => {
      if (!value) return undefined;
      const url = new URL(value);
      const id =
        url.hostname === "youtu.be"
          ? url.pathname.split("/")[1]
          : url.pathname === "/watch"
            ? url.searchParams.get("v")
            : url.pathname.split("/")[2];
      return `https://www.youtube.com/watch?v=${id}`;
    })
    .optional(),
});
function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
  });
}
function safeResponse(value: unknown) {
  // A second allowlist boundary prevents provider credentials from reaching browsers.
  return response(safeSessionSchema.parse(value));
}
function enabled() {
  return process.env.CURLCAST_M4_LOCAL_YOUTUBE === "disposable";
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
      /* An expired bearer does not shadow a verified account. */
    }
  }
  const account = await verifiedCompletionAccount();
  return account.ok ? account.value : undefined;
}
function failure(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "42501")
    return response(
      { error: "Broadcast administrator access is required." },
      403,
    );
  if (code === "55000")
    return response(
      { error: "This game cannot prepare or resume local output." },
      409,
    );
  return response(
    { error: "Local YouTube control is temporarily unavailable." },
    503,
  );
}
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return response({ error: "Invalid game." }, 400);
  if (!enabled())
    return response(
      { error: "Local YouTube control is unavailable from this deployment." },
      503,
    );
  try {
    const authority = await credential(request, parsed.data.id);
    if (!authority) return failure({ code: "42501" });
    return safeResponse(await readM4Session(parsed.data.id, authority));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  const parsed = paramsSchema.safeParse(await context.params);
  const text = await request.text().catch(() => "");
  let input: unknown;
  try {
    if (text.length > 1_024) throw Error();
    input = JSON.parse(text);
  } catch {
    return response({ error: "Invalid local output request." }, 400);
  }
  const body = bodySchema.safeParse(input);
  if (!parsed.success || !body.success)
    return response({ error: "Invalid local output request." }, 400);
  if (!enabled())
    return response(
      { error: "Local YouTube control is unavailable from this deployment." },
      503,
    );
  let trustedOrigin: string;
  try {
    trustedOrigin = new URL(
      participantUrl(request, "/", {
        NODE_ENV: "production",
        APP_BASE_URL: process.env.APP_BASE_URL,
      }),
    ).origin;
  } catch {
    return failure(null);
  }
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== trustedOrigin)
  )
    return response({ error: "Invalid request origin." }, 403);
  try {
    const authority = await credential(request, parsed.data.id);
    if (!authority) return failure({ code: "42501" });
    if (body.data.action === "prepare" && !m4Configuration())
      return response(
        { error: "Local YouTube preparation is not configured." },
        503,
      );
    return safeResponse(
      body.data.action === "prepare"
        ? await prepareM4Session(parsed.data.id, authority)
        : body.data.action === "go-live"
          ? await goLiveM4Session(parsed.data.id, authority)
          : await stopM4Session(parsed.data.id, authority),
    );
  } catch (error) {
    return failure(error);
  }
}
