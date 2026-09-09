import { z } from "zod";
import {
  verifiedCompletionAccount,
  type CompletionCredential,
} from "@/lib/game-completion";
import { readAccessToken } from "@/lib/tokens";
import { participantUrl } from "@/lib/participant-links";
import {
  approveM4DesktopPairing,
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
  type Context,
} from "../desktop/http";
export const dynamic = "force-dynamic";
const bodySchema = z
  .object({ challenge: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const approved = session.extend({ code: secret });
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
      /* A stale token cannot override a verified account session. */
    }
  }
  const account = await verifiedCompletionAccount();
  return account.ok ? account.value : undefined;
}
export async function POST(request: Request, context: Context) {
  try {
    const id = identifier.safeParse((await context.params).id);
    const body = bodySchema.safeParse(await input(request));
    if (!id.success || !body.success) return unavailable(400);
    if (!m4DesktopEnabled()) return unavailable();
    const canonical = new URL(
      participantUrl(request, "/", {
        NODE_ENV: "production",
        APP_BASE_URL: process.env.APP_BASE_URL,
      }),
    ).origin;
    const origin = request.headers.get("origin");
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== canonical)
    )
      return unavailable(403);
    const authority = await credential(request, id.data);
    if (!authority) return unavailable(403);
    return reply(
      approved.parse(
        await approveM4DesktopPairing(id.data, authority, body.data.challenge),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
