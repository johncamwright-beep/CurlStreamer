import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reopenGameSchema } from "@/lib/game-reopen";
import { reopenGame } from "@/lib/providers/game-reopen";

export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const id = z.uuid().safeParse((await context.params).id);
  const body = reopenGameSchema.safeParse(
    await request.json().catch(() => null),
  );
  const respond = (value: unknown, status = 200) =>
    NextResponse.json(value, {
      status,
      headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
    });
  if (!id.success || !body.success)
    return respond({ error: "Invalid reopen request." }, 400);
  const result = await reopenGame(id.data, body.data);
  if (!result.ok) {
    if (result.code === "42501")
      return respond(
        {
          error:
            "Sign in as this team's owner or administrator to reopen scoring.",
        },
        403,
      );
    if (result.code === "PT423")
      return respond(
        {
          error:
            "The stream is still closing. Retry shutdown before reopening scoring.",
        },
        409,
      );
    if (["PT409", "55000"].includes(result.code))
      return respond(
        { error: "The game changed. Reload it before reopening scoring." },
        409,
      );
    return respond(
      { error: "Scoring could not be reopened. Please try again." },
      503,
    );
  }
  try {
    revalidatePath("/dashboard");
    revalidatePath("/teams", "layout");
    revalidatePath(`/games/${id.data}`);
    revalidatePath(`/score/${id.data}`);
  } catch {
    /* The database commit is authoritative. */
  }
  return respond({ status: "active", gameId: id.data });
}
