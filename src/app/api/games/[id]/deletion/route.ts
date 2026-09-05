import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadActiveTeam } from "@/lib/team-games";
import { terminateGameLiveKit } from "@/lib/providers/livekit";
import { listCameraIdentityGenerations } from "@/lib/store";
import { stopGameBroadcast } from "@/lib/broadcast-session";
import {
  verifiedCompletionAccount,
  type CompletionCredential,
} from "@/lib/game-completion";

const paramsSchema = z.object({ id: z.string().uuid() });

type Cleanup = {
  status: "pending" | "failed" | "complete";
  attempts: number;
  lastError: string | null;
};

function cleanupRow(value: Record<string, unknown>): Cleanup {
  return {
    status: value.status as Cleanup["status"],
    attempts: Number(value.attempts),
    lastError: (value.last_error as string | null) ?? null,
  };
}

async function cleanupDeletedGame(
  database: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  gameId: string,
  authority: CompletionCredential,
) {
  const parameters = { p_user_id: userId, p_game_id: gameId };
  const current = await database.rpc("get_game_deletion_cleanup", parameters);
  if (current.error) return { kind: "unavailable" as const };
  const existing = (current.data as Record<string, unknown>[] | null)?.[0];
  if (!existing) return { kind: "not-found" as const };
  const cleanup = cleanupRow(existing);
  if (cleanup.status === "complete")
    return { kind: "recorded" as const, cleanup };

  const providerErrors: string[] = [];
  try {
    const broadcast = await stopGameBroadcast(gameId, authority);
    if (!["idle", "stopped"].includes(broadcast.status))
      throw new Error("not stopped");
  } catch {
    providerErrors.push("YouTube broadcast shutdown was not confirmed");
  }
  try {
    const generations = await listCameraIdentityGenerations(gameId);
    await terminateGameLiveKit(gameId, generations);
  } catch {
    providerErrors.push("LiveKit room shutdown was not confirmed");
  }
  const providerError = providerErrors.join("; ") || undefined;
  const recorded = await database.rpc("record_game_deletion_cleanup", {
    ...parameters,
    p_succeeded: !providerError,
    p_error: providerError ?? null,
  });
  const row = (recorded.data as Record<string, unknown>[] | null)?.[0];
  if (recorded.error || !row) return { kind: "unavailable" as const };
  return { kind: "recorded" as const, cleanup: cleanupRow(row) };
}

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
  const verified = await verifiedCompletionAccount();
  if (!verified.ok)
    return NextResponse.json(
      { error: "A verified account is required." },
      { status: 403 },
    );
  const rpc =
    operation === "delete" ? "soft_delete_team_game" : "restore_team_game";
  const database = createAdminSupabaseClient();
  const { data: changed, error } = await database.rpc(rpc, {
    p_user_id: data.user.id,
    p_game_id: parsed.data.id,
  });
  if (error) {
    const lifecycleConflict = error.code === "55000";
    return NextResponse.json(
      {
        error:
          lifecycleConflict && operation === "delete"
            ? "Stop the live session before deleting this game."
            : `The game could not be ${operation === "delete" ? "deleted" : "restored"}.`,
      },
      { status: lifecycleConflict ? 409 : 503 },
    );
  }
  if (operation === "delete") {
    const cleanup = await cleanupDeletedGame(
      database,
      data.user.id,
      id,
      verified.value,
    );
    if (cleanup.kind === "not-found" && !changed)
      return NextResponse.json(
        { error: "The deleted game could not be found." },
        { status: 404 },
      );
    if (cleanup.kind === "unavailable" && !changed)
      return NextResponse.json(
        { error: "The deletion status could not be confirmed. Try again." },
        { status: 503 },
      );
    if (cleanup.kind === "unavailable" || cleanup.kind === "not-found")
      return NextResponse.json(
        {
          changed: Boolean(changed),
          deletionCommitted: true,
          warning:
            "The game was deleted, but live video cleanup could not be confirmed. Try deleting it again.",
          cleanup: {
            status: "pending",
            attempts: 0,
            lastError: "Cleanup status could not be confirmed",
          } satisfies Cleanup,
        },
        { status: 202 },
      );
    if (cleanup.kind === "recorded" && cleanup.cleanup.status !== "complete")
      return NextResponse.json(
        {
          changed: Boolean(changed),
          deletionCommitted: true,
          warning:
            "The game was deleted, but live video cleanup needs to be retried.",
          cleanup: cleanup.cleanup,
        },
        { status: 202 },
      );
    return NextResponse.json({
      changed: Boolean(changed),
      deletionCommitted: true,
      ...(cleanup.kind === "recorded" ? { cleanup: cleanup.cleanup } : {}),
    });
  }
  return NextResponse.json({ changed: Boolean(changed) });
}

async function retryCleanup(id: string) {
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
  const verified = await verifiedCompletionAccount();
  if (!verified.ok)
    return NextResponse.json(
      { error: "A verified account is required." },
      { status: 403 },
    );

  const cleanup = await cleanupDeletedGame(
    createAdminSupabaseClient(),
    data.user.id,
    parsed.data.id,
    verified.value,
  );
  if (cleanup.kind === "not-found")
    return NextResponse.json(
      { error: "This game is no longer deleted." },
      { status: 409 },
    );
  if (cleanup.kind === "unavailable")
    return NextResponse.json(
      { error: "Live video cleanup could not be confirmed." },
      { status: 503 },
    );
  if (cleanup.cleanup.status !== "complete")
    return NextResponse.json(
      {
        error: "Live video cleanup needs to be retried.",
        cleanup: cleanup.cleanup,
      },
      { status: 503 },
    );
  return NextResponse.json({ cleanup: cleanup.cleanup });
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

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return retryCleanup((await params).id);
}
