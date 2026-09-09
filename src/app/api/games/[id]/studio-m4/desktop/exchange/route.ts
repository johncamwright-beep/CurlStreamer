import { z } from "zod";
import {
  exchangeM4DesktopPairing,
  m4DesktopEnabled,
} from "@/lib/providers/m4-desktop-authority";
import {
  identifier,
  secret,
  session,
  reply,
  unavailable,
  failure,
  input,
  browserRequest,
  type Context,
} from "../http";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ code: secret, verifier: secret }).strict();
const exchanged = session.extend({
  bearer: secret,
  leaseExpiresAt: z.iso.datetime({ offset: true }),
});
export async function POST(request: Request, context: Context) {
  try {
    const id = identifier.safeParse((await context.params).id);
    const body = bodySchema.safeParse(await input(request));
    if (!id.success || !body.success) return unavailable(400);
    if (browserRequest(request)) return unavailable(403);
    if (!m4DesktopEnabled()) return unavailable();
    return reply(
      exchanged.parse(
        await exchangeM4DesktopPairing(
          id.data,
          body.data.code,
          body.data.verifier,
        ),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
