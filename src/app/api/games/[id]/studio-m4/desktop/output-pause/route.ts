import { z } from "zod";
import { traceStudioRequest } from "@/lib/providers/connection-diagnostics-server";
import { m4DesktopEnabled } from "@/lib/providers/m4-desktop-authority";
import { recordM4OutputPause } from "@/lib/providers/m4-output-intent";
import {
  browserRequest,
  failure,
  identifier,
  input,
  reply,
  secret,
  unavailable,
  type Context,
} from "../http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const bodySchema = z
  .object({
    sessionId: identifier,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    intentId: identifier,
    pauseId: identifier,
    stoppedAt: instant,
    resumedAt: instant.optional(),
  })
  .strict()
  .refine(
    ({ stoppedAt, resumedAt }) =>
      resumedAt === undefined || Date.parse(resumedAt) > Date.parse(stoppedAt),
  );

export function POST(request: Request, context: Context) {
  return traceStudioRequest(() => post(request, context), "youtube");
}

async function post(request: Request, context: Context) {
  try {
    if (browserRequest(request)) return unavailable(403);
    const bearer = secret.safeParse(
      request.headers
        .get("authorization")
        ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],
    );
    if (!bearer.success) return unavailable(403);
    const id = identifier.safeParse((await context.params).id);
    const body = bodySchema.safeParse(await input(request));
    if (!id.success || !body.success) return unavailable(400);
    if (!m4DesktopEnabled()) return unavailable();
    const { sessionId, generation, ...pause } = body.data;
    await recordM4OutputPause(
      id.data,
      { sessionId, generation, bearer: bearer.data },
      pause,
    );
    return reply({ recorded: true });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code === "22023" ? unavailable(400) : failure(error);
  }
}
