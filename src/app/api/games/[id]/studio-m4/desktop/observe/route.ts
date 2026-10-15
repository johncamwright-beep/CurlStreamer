import { z } from "zod";
import { m4YouTubeFailureCode } from "@/lib/providers/m4-youtube-failure";
import { traceStudioRequest } from "@/lib/providers/connection-diagnostics-server";
import {
  m4DesktopObservationEnabled,
  m4DesktopObservationResultSchema,
  observeM4DesktopOutput,
} from "@/lib/providers/m4-desktop-observation";
import {
  identifier,
  secret,
  reply,
  unavailable,
  failure,
  input,
  browserRequest,
  type Context,
} from "../http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const bodySchema = z
  .object({ sessionId: identifier, generation, intentId: identifier })
  .strict();

/** Provider receipt only. This route never renews desktop authority or starts output. */
export function POST(request: Request, context: Context) {
  return traceStudioRequest(() => post(request, context), "youtube");
}
async function post(request: Request, context: Context) {
  try {
    const id = identifier.safeParse((await context.params).id);
    const body = bodySchema.safeParse(await input(request));
    if (!id.success || !body.success) return unavailable(400);
    if (browserRequest(request)) return unavailable(403);
    const bearer = secret.safeParse(
      request.headers
        .get("authorization")
        ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],
    );
    if (!bearer.success) return unavailable(403);
    if (!m4DesktopObservationEnabled()) return unavailable();
    const result = m4DesktopObservationResultSchema.parse(
      await observeM4DesktopOutput(
        id.data,
        {
          sessionId: body.data.sessionId,
          generation: body.data.generation,
          bearer: bearer.data,
        },
        body.data.intentId,
      ),
    );
    if (
      result.intentId !== body.data.intentId ||
      result.sessionId !== body.data.sessionId ||
      result.generation !== body.data.generation
    )
      return unavailable();
    return reply(result);
  } catch (error) {
    const detail = z
      .object({ reason: m4YouTubeFailureCode, code: z.string().optional() })
      .safeParse(error);
    if (detail.success && !detail.data.code)
      return reply(
        {
          code: detail.data.reason,
          error:
            "YouTube status is unavailable. This status check does not stop video delivery.",
        },
        503,
      );
    return failure(error);
  }
}
