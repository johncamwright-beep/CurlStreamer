import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeGame, authorizationError } from "@/lib/game-authorization";
import { broadcastGame, type BroadcastGame } from "@/lib/game-projection";
import type { Sponsor } from "@/lib/types";
import { studioOrigin } from "@/lib/studio-origin";
import { readGame } from "@/lib/providers/game-read";
import { gameBroadcastSponsors } from "@/lib/providers/sponsor-library";
import {
  cameraRoleSchema,
  signalSchema,
  signalAllowed,
} from "@/lib/m2-studio-protocol";
import {
  requireStudioConfiguration,
  StudioRejected,
  studioAction,
  issueStudioTicket,
  broadcastStudioSignal,
} from "@/lib/providers/m2-studio-session";
import {
  programCookieName,
  programCookieSeconds,
  createProgramGrant,
  exchangeProgramGrant,
  readProgramScope,
  checkAvailableProgramScope,
  prepareProgramScope,
} from "@/lib/providers/m3-program-session";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }).strict(),
  z
    .object({
      action: z.literal("exchange"),
      code: z.string().regex(/^[\w-]{43}$/),
    })
    .strict(),
  z
    .object({
      action: z.enum(["ticket", "check", "signal", "stop"]),
      cameraRole: cameraRoleSchema,
      sessionId: z.uuid().optional(),
      negotiationId: z.uuid().optional(),
      signal: signalSchema.optional(),
    })
    .strict(),
]);
function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
  });
}
function failure(cause: unknown) {
  return response(
    {
      error:
        cause instanceof StudioRejected
          ? "Program authority expired. Prepare a new OBS source."
          : "Program service unavailable.",
    },
    cause instanceof StudioRejected ? 409 : 503,
  );
}
function sameOrigin(request: Request, trustedOrigin: string) {
  const origin = request.headers.get("origin");
  return (
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    (!origin || origin === trustedOrigin)
  );
}
function privateProgramSponsorIds(
  game: BroadcastGame,
  librarySponsors: Sponsor[],
) {
  const key = (sponsor: {
    name: string;
    altText?: string;
    dataUrl: string;
    rotation: number;
  }) =>
    JSON.stringify([
      sponsor.name,
      sponsor.altText ?? "",
      sponsor.dataUrl,
      sponsor.rotation,
    ]);
  const ids = new Map<string, string[]>();
  for (const sponsor of librarySponsors) {
    if (!z.uuid().safeParse(sponsor.id).success) continue;
    const value = key(sponsor);
    ids.set(value, [...(ids.get(value) ?? []), sponsor.id]);
  }
  return {
    ...game,
    sponsors: game.sponsors.map((sponsor) => {
      const id = ids
        .get(
          key({
            name: String(sponsor.name),
            altText:
              typeof sponsor.altText === "string" ? sponsor.altText : undefined,
            dataUrl: String(sponsor.dataUrl),
            rotation: Number(sponsor.rotation),
          }),
        )
        ?.shift();
      return id ? { ...sponsor, id } : sponsor;
    }),
  };
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = z.uuid().safeParse((await params).id);
  let trustedOrigin: string;
  try {
    // The public HTTPS origin is deployment configuration, never a proxy header.
    // Next may see loopback HTTP behind the local Cloudflare tunnel.
    trustedOrigin = studioOrigin(request);
  } catch {
    return response({ error: "Program service unavailable." }, 503);
  }
  if (!id.success || !sameOrigin(request, trustedOrigin))
    return response({ error: "Invalid program request" }, 400);
  let body: z.infer<typeof schema>;
  try {
    const text = await request.text();
    if (text.length > 40_000)
      return response({ error: "Request too large" }, 413);
    body = schema.parse(JSON.parse(text));
  } catch {
    return response({ error: "Invalid program request" }, 400);
  }
  try {
    requireStudioConfiguration();
    if (body.action === "prepare") {
      const auth = await authorizeGame(request, id.data, {
        accountRoles: ["owner", "team_admin", "game_operator"],
        tokenAllowed: (access) => access.purpose === "organizer",
      });
      if (!auth.ok) {
        const denied = authorizationError(auth);
        return response({ error: denied.error }, denied.status);
      }
      const { scope, sessions } = await prepareProgramScope(
        id.data,
        auth.via === "account" ? auth.organizationId : undefined,
      );
      const code = await createProgramGrant(scope);
      return response({
        sourceUrl: new URL(
          `/studio-m3/${id.data}/program#code=${code}`,
          trustedOrigin,
        ).href,
        sessions,
      });
    }
    if (body.action === "exchange") {
      const value = await exchangeProgramGrant(id.data, body.code);
      const result = response({ ok: true });
      result.cookies.set(programCookieName, value, {
        httpOnly: true,
        secure: new URL(trustedOrigin).protocol === "https:",
        sameSite: "strict",
        path: `/api/games/${id.data}/studio-m3`,
        maxAge: programCookieSeconds,
      });
      return result;
    }
    if (
      body.action === "signal" &&
      (!body.signal ||
        !body.negotiationId ||
        !signalAllowed("receiver", body.signal))
    )
      return response({ error: "Invalid receiver signal" }, 400);
    const scope = await readProgramScope(request, id.data);
    const sessionId = scope.sessions[body.cameraRole];
    if (body.sessionId && body.sessionId !== sessionId)
      throw new StudioRejected();
    const input = { ...body, side: "receiver" as const, sessionId };
    const authority = { organizationId: scope.organizationId };
    const ticket = await studioAction(id.data, input, authority);
    if (body.action === "signal") {
      await broadcastStudioSignal(ticket, "receiver", body.signal);
      await studioAction(id.data, { ...input, action: "check" }, authority);
      return response({ ok: true });
    }
    return response(
      body.action === "ticket"
        ? await issueStudioTicket(id.data, ticket, "receiver")
        : ticket,
    );
  } catch (cause) {
    return failure(cause);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return response({ error: "Invalid game" }, 400);
  try {
    requireStudioConfiguration();
    const scope = await readProgramScope(request, id.data);
    await checkAvailableProgramScope(scope);
    const result = await readGame(id.data);
    if (result.kind !== "active") throw new StudioRejected();
    const sponsors = await gameBroadcastSponsors(id.data);
    // A successful empty library may still have the original bundled demo art.
    // Never resurrect stored uploads, archived library assets, or private paths.
    const bundledSponsors = result.game.sponsors.filter(
      (sponsor) =>
        sponsor.enabled &&
        (sponsor.dataUrl === "/sponsors/community.svg" ||
          sponsor.dataUrl === "/sponsors/rock.svg"),
    );
    const publicProjection = broadcastGame(
      { ...result.game, sponsors: bundledSponsors },
      sponsors,
    );
    // The private renderer needs the real UUID to verify that a signed object
    // belongs to the library sponsor. Public Broadcast retains opaque IDs.
    const game = privateProgramSponsorIds(publicProjection, sponsors);
    await checkAvailableProgramScope(scope);
    return response({ game, organizationId: scope.organizationId });
  } catch (cause) {
    return failure(cause);
  }
}
