import { z } from "zod";
import {
  heartbeatM4Desktop,
  stopM4Desktop,
  m4DesktopEnabled,
} from "@/lib/providers/m4-desktop-authority";
import {
  identifier,
  secret,
  lease,
  reply,
  unavailable,
  failure,
  input,
  browserRequest,
  type Context,
} from "./http";
export const dynamic = "force-dynamic";
const bodySchema = z
  .object({
    action: z.enum(["heartbeat", "stop"]),
    sessionId: identifier,
    generation: z.number().int().positive(),
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
    // Turning off new pairing must not prevent an existing authority from stopping.
    if (body.data.action !== "stop" && !m4DesktopEnabled())
      return unavailable();
    const authority = {
      sessionId: body.data.sessionId,
      generation: body.data.generation,
      bearer: bearer.data,
    };
    return reply(
      lease.parse(
        await (
          body.data.action === "stop" ? stopM4Desktop : heartbeatM4Desktop
        )(id.data, authority),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
