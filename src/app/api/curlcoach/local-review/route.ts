import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readTeamSettings } from "@/lib/providers/team-settings";
import { rosterPlayers } from "@/lib/providers/player-contacts";
import { listTeamHierarchyGames } from "@/lib/team-hierarchy-service";
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
const gameEventSchema = z.object({
  id: z.uuid(),
  event_id: z.uuid().nullable(),
});
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
  return { account, scope, state };
}
const enabled = () => process.env.CURLCOACH_ENABLED === "true" && !labEnabled();
async function players(
  current: NonNullable<Awaited<ReturnType<typeof context>>>,
) {
  if (current.state.roster?.length) return current.state.roster;
  const { settings } = await readTeamSettings(current.scope.organizationId);
  return rosterPlayers(current.scope.organizationId, settings);
}
export async function GET(request: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404, headers });
  const parsed = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("game"));
  if (!parsed.success) return new NextResponse(null, { status: 400, headers });
  try {
    const current = await context(parsed.data);
    if (!current) return new NextResponse(null, { status: 403, headers });
    // API roles cannot query games directly. The catalog RPC verifies the
    // actor's active team and excludes deleted games.
    const catalog = await listTeamHierarchyGames(current.account.user);
    if (!catalog.ok) {
      if (catalog.kind === "authorization") throw Error("Game unavailable");
      return NextResponse.json(
        {
          error: "Could not load the game's event. Tap Reload shots to retry.",
        },
        { status: 503, headers },
      );
    }
    const game = gameEventSchema.safeParse(
      catalog.value.find(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "id" in row &&
          row.id === parsed.data,
      ),
    );
    if (!game.success) throw Error("Game unavailable");
    return NextResponse.json(
      {
        eventId: game.data.event_id ?? "standalone",
        revision: current.state.revision,
        players: await players(current),
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
    if (input.data.shotId === null) {
      const review = input.data.review;
      const player =
        review.audience === "player"
          ? (await players(current)).find((p) => p.id === input.data.playerId)
          : undefined;
      if (review.audience === "player" && !player)
        return NextResponse.json(
          { error: "Choose a player from this team's roster." },
          { status: 400, headers },
        );
      const { error } = await createAdminSupabaseClient().rpc(
        "save_standalone_review",
        {
          p_actor: current.scope.actorUserId,
          p_org: current.scope.organizationId,
          p_game: current.scope.gameId,
          p_request: review.id,
          p_audience: review.audience,
          p_player: player?.id ?? null,
          p_name: player?.name ?? null,
          p_note: review.notes,
          p_selected: review.selectedAt,
          ...(review.shotContext && {
            p_end: review.shotContext.end,
            p_shot: review.shotContext.shot,
          }),
        },
      );
      if (error) throw Error("Review storage unavailable");
      return NextResponse.json({ saved: true }, { headers });
    }
    const command = localReviewCommand(current.state, input.data);
    await saveCoachState(current.scope, current.state, command);
    return NextResponse.json({ saved: true }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not save this flag. Reload and try again; your selection and notes are still here.",
      },
      { status: 409, headers },
    );
  }
}
