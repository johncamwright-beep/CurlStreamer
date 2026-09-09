import { z } from "zod";
import {
  deliverM4Target,
  m4TargetHandoffEnabled,
  m4TargetResultSchema,
} from "@/lib/providers/m4-target-delivery";
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
const bodySchema = z
  .object({
    sessionId: identifier,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    intentId: identifier,
  })
  .strict();

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
    if (!m4TargetHandoffEnabled()) return unavailable();
    const result = m4TargetResultSchema.parse(
      await deliverM4Target(
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
