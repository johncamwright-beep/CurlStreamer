import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorized,
  labEnabled,
  sameOrigin,
  sessionCookie,
} from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { emptyState } from "@/lib/curlcoach/model";
import { sampleEvent } from "@/lib/curlcoach/event";
import { loadCoachState } from "@/lib/providers/curlcoach-store";
import {
  documentWriteSchema,
  loadEnhanced,
  saveEnhanced,
} from "@/lib/providers/shot-tracker-enhanced";
import {
  readCoachState,
  readLocalEnhanced,
  writeLocalEnhanced,
} from "@/lib/providers/curlcoach-local";
const headers = { "Cache-Control": "private, no-store" };
const selection = z
  .object({
    gameId: z.string().min(1).max(100).optional(),
    eventId: z.string().min(1).max(100).optional(),
  })
  .strict();
async function access() {
  if (process.env.CURLCOACH_ENABLED !== "true") return null;
  if (labEnabled())
    return (await authorized((await cookies()).get(sessionCookie)?.value))
      ? {
          organizationId: "curlcoach-synthetic-org",
          actorUserId: "synthetic-coach",
        }
      : null;
  const account = await requireCoachAccount();
  return account
    ? { organizationId: account.organizationId, actorUserId: account.userId }
    : null;
}
function localInitial(gameId?: string, eventId?: string) {
  if (!gameId) return { ...emptyState(), gameId: "enhanced-preferences" };
  const game = sampleEvent(eventId ?? "practice").games.find(
    (g) => g.id === gameId,
  );
  if (!game) throw new Error("Game unavailable");
  return game.state;
}
export async function GET(request: Request) {
  const account = await access();
  if (!account) return new NextResponse(null, { status: 403, headers });
  const input = selection.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (
    !input.success ||
    (!labEnabled() &&
      input.data.gameId &&
      !z.uuid().safeParse(input.data.gameId).success)
  )
    return new NextResponse(null, { status: 400, headers });
  try {
    const scope = { ...account, gameId: input.data.gameId };
    const state = labEnabled()
      ? readCoachState(localInitial(input.data.gameId, input.data.eventId))
      : input.data.gameId
        ? await loadCoachState(
            { ...scope, gameId: input.data.gameId },
            {
              ...emptyState(),
              organizationId: account.organizationId,
              gameId: input.data.gameId,
              roster: [],
            },
          )
        : undefined;
    const documents = labEnabled()
      ? readLocalEnhanced(localInitial(input.data.gameId, input.data.eventId))
      : await loadEnhanced(scope, state);
    return NextResponse.json({ documents, scope: account }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Enhanced settings unavailable. Retry before recording Enhanced observations.",
      },
      { status: 503, headers },
    );
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return new NextResponse(null, { status: 403, headers });
  const account = await access();
  if (!account) return new NextResponse(null, { status: 403, headers });
  const input = selection
    .extend({ write: documentWriteSchema })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: input.error.issues.map((i) => i.message).join(" ") },
      { status: 400, headers },
    );
  const { gameId, eventId, write } = input.data;
  if (
    (write.kind === "preferences") !== !gameId ||
    (!labEnabled() && gameId && !z.uuid().safeParse(gameId).success)
  )
    return new NextResponse(null, { status: 400, headers });
  try {
    const scope = { ...account, gameId };
    const state =
      !labEnabled() && gameId
        ? await loadCoachState(
            { ...scope, gameId },
            {
              ...emptyState(),
              organizationId: account.organizationId,
              gameId,
              roster: [],
            },
          )
        : undefined;
    const result = labEnabled()
      ? writeLocalEnhanced(localInitial(gameId, eventId), write)
      : await saveEnhanced(scope, write, state);
    return NextResponse.json(result, { headers });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Enhanced save not confirmed.",
      },
      { status: 409, headers },
    );
  }
}
