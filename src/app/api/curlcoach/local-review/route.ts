import { NextResponse } from "next/server";
import { z } from "zod";
import { labEnabled, sameOrigin } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { currentShots, emptyState } from "@/lib/curlcoach/model";
import {
  localReviewSaveSchema,
  localReviewCommand,
} from "@/lib/curlcoach/local-review";
import {
  loadCoachState,
  saveCoachState,
} from "@/lib/providers/curlcoach-store";
const headers = { "Cache-Control": "private, no-store" };
async function context(gameId: string) {
  const account = await requireCoachAccount();
  if (!account) return null;
  const scope = {
    organizationId: account.organizationId,
    actorUserId: account.userId,
    gameId,
  };
  const state = await loadCoachState(scope, {
    ...emptyState(),
    organizationId: scope.organizationId,
    gameId,
    roster: [],
  });
  return { scope, state };
}
const enabled = () => process.env.CURLCOACH_ENABLED === "true" && !labEnabled();
export async function GET(request: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404, headers });
  const parsed = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("game"));
  if (!parsed.success) return new NextResponse(null, { status: 400, headers });
  try {
    const current = await context(parsed.data);
    if (!current) return new NextResponse(null, { status: 403, headers });
    return NextResponse.json(
      {
        revision: current.state.revision,
        accountScope: {
          actorId: current.scope.actorUserId,
          organizationId: current.scope.organizationId,
        },
        shots: currentShots(current.state.events).map((shot) => ({
          id: shot.id,
          playerId: shot.playerId,
          end: shot.end,
          stone: shot.stone,
          position: shot.position,
          player:
            current.state.roster?.find((player) => player.id === shot.playerId)
              ?.name ?? shot.position,
          note: shot.note,
          flagged: shot.flagged,
        })),
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "This game's recorded shots could not be opened." },
      { status: 403, headers },
    );
  }
}
export async function POST(request: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404, headers });
  if (!sameOrigin(request))
    return new NextResponse(null, { status: 403, headers });
  const input = localReviewSaveSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid local review." },
      { status: 400, headers },
    );
  try {
    const current = await context(input.data.review.gameId);
    if (!current) return new NextResponse(null, { status: 403, headers });
    const command = localReviewCommand(current.state, input.data);
    await saveCoachState(current.scope, current.state, command);
    return NextResponse.json({ saved: true }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not save this flag. Reload the shots; the game may have changed or need reopening.",
      },
      { status: 409, headers },
    );
  }
}
