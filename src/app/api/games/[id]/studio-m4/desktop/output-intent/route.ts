import { z } from "zod";
import { m4DesktopEnabled } from "@/lib/providers/m4-desktop-authority";
import { claimM4OutputIntent } from "@/lib/providers/m4-output-intent";
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
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const bodySchema = z
  .object({ sessionId: identifier, generation, intentId: identifier })
  .strict();
const resultSchema = z
  .object({
    intentId: identifier,
    sessionId: identifier,
    generation,
    phase: z.enum(["reserved", "quarantined", "stop_requested"]),
    deliveryRecorded: z.boolean(),
  })
  .refine((value) => value.phase !== "reserved" || !value.deliveryRecorded);

/** Reserve a journal intent only; this endpoint never delivers credentials or starts output. */
export async function POST(request: Request, context: Context) {
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
    if (!m4DesktopEnabled()) return unavailable();
    const result = resultSchema.parse(
      await claimM4OutputIntent(
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
    return failure(error);
  }
}
