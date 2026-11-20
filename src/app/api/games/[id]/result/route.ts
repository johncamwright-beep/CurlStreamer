import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { completedResultCorrectionSchema } from "@/lib/completed-result";
import {
  readCompletedResult,
  correctCompletedResult,
} from "@/lib/providers/completed-result";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
type Context = { params: Promise<{ id: string }> };
function response(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "cache-control": "no-store", vary: "Cookie, Authorization" },
  });
}
function failure(kind: string) {
  if (kind === "authorization")
    return response(
      {
        error:
          "Sign in as this team's owner or administrator to edit the final result.",
      },
      403,
    );
  if (kind === "conflict")
    return response(
      {
        error:
          "The final result changed. Reload it before saving another correction.",
        code: "result_conflict",
      },
      409,
    );
  if (kind === "terminal")
    return response(
      {
        error:
          "Only a completed, available game can have its final result corrected.",
      },
      409,
    );
  return response(
    { error: "Final result editing is temporarily unavailable." },
    503,
  );
}
export async function GET(_request: Request, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return response({ error: "Invalid game" }, 400);
  const result = await readCompletedResult(params.data.id);
  return result.ok ? response(result.value) : failure(result.kind);
}
export async function PATCH(request: Request, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  const body = completedResultCorrectionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!params.success || !body.success)
    return response(
      {
        error:
          "Enter ordered, valid end scores and a reason for the correction.",
      },
      400,
    );
  const result = await correctCompletedResult(params.data.id, body.data);
  if (!result.ok) return failure(result.kind);
  try {
    revalidatePath("/dashboard");
    revalidatePath("/teams", "layout");
    revalidatePath(`/games/${params.data.id}`);
  } catch {
    // A committed correction remains successful if cache invalidation fails.
  }
  return response(result.value);
}
