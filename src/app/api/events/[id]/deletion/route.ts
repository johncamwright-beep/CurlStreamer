import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { verifiedCompletionAccount } from "@/lib/game-completion";
import { cleanupDeletedGame } from "@/lib/game-deletion-cleanup";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Same-origin request required." },
      { status: 403 },
    );
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  const body = z
    .object({ confirmed: z.literal(true) })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json(
      { error: "Confirm event deletion." },
      { status: 400 },
    );
  const account = await verifiedCompletionAccount();
  if (!account.ok)
    return NextResponse.json(
      { error: "Verified team administrator access is required." },
      { status: 403 },
    );
  const db = createAdminSupabaseClient();
  const { data, error } = await db.rpc("soft_delete_team_event", {
    p_user_id: account.value.userId,
    p_event_id: parsed.data,
  });
  if (error)
    return NextResponse.json(
      {
        error:
          error.code === "55000"
            ? "Stop all live sessions in this event before deleting it."
            : "Event deletion could not be completed.",
      },
      {
        status:
          error.code === "42501" ? 403 : error.code === "55000" ? 409 : 503,
      },
    );
  const ids = z.array(z.uuid()).parse(data);
  let pending = false;
  for (const id of ids) {
    const cleanup = await cleanupDeletedGame(
      db,
      account.value.userId,
      id,
      account.value,
    ).catch(() => null);
    if (
      !cleanup ||
      cleanup.kind !== "recorded" ||
      cleanup.cleanup.status !== "complete"
    )
      pending = true;
  }
  return NextResponse.json({
    deleted: true,
    gameIds: ids,
    cleanupPending: pending,
  });
}
