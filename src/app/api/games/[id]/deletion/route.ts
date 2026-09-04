import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadActiveTeam } from "@/lib/team-games";
import { updateGame } from "@/lib/store";

const paramsSchema = z.object({ id: z.string().uuid() });

async function change(
  request: Request,
  id: string,
  operation: "delete" | "restore",
) {
  const parsed = paramsSchema.safeParse({ id });
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  const { data } = await (await createServerSupabaseClient()).auth.getUser();
  if (!data.user)
    return NextResponse.json(
      { error: "Sign in is required." },
      { status: 401 },
    );
  const team = await loadActiveTeam(data.user);
  if (
    team.kind !== "ready" ||
    !["owner", "team_admin"].includes(team.team.role)
  )
    return NextResponse.json(
      { error: "Team administrator access is required." },
      { status: 403 },
    );
  const rpc =
    operation === "delete" ? "soft_delete_team_game" : "restore_team_game";
  const { data: changed, error } = await createAdminSupabaseClient().rpc(rpc, {
    p_user_id: data.user.id,
    p_game_id: parsed.data.id,
  });
  if (error) {
    const live = error.code === "55000";
    return NextResponse.json(
      {
        error: live
          ? "Stop the live session before deleting this game."
          : `The game could not be ${operation === "delete" ? "deleted" : "restored"}.`,
      },
      { status: live ? 409 : 503 },
    );
  }
  // Revoke any still-live participant credentials as part of deletion. The
  // recoverable database row remains, but token authorization sees it closed.
  if (operation === "delete" && changed) {
    try {
      const closed = await updateGame(id, { type: "close-game" });
      if (!closed) throw new Error("missing state");
    } catch {
      console.error("Game deletion state revocation failed", {
        operation: "close_deleted_game",
        category: "game_state",
      });
      return NextResponse.json(
        {
          error:
            "The game was deleted but access revocation could not be confirmed.",
        },
        { status: 503 },
      );
    }
  }
  return NextResponse.json({ changed: Boolean(changed) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return change(request, (await params).id, "delete");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return change(request, (await params).id, "restore");
}
