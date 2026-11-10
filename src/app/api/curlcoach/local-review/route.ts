import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readTeamSettings } from "@/lib/providers/team-settings";
import { rosterPlayers } from "@/lib/providers/player-contacts";
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
    const { data: game, error: gameError } = await createAdminSupabaseClient()
      .from("games")
      .select("event_id")
      .eq("id", parsed.data)
      .eq("organization_id", current.scope.organizationId)
      .maybeSingle();
    if (gameError || !game) throw Error("Game unavailable");
    return NextResponse.json(
      {
        eventId: game.event_id ?? "standalone",
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
