import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { maintainYouTubeAuthorizations } from "@/lib/providers/youtube-authorization-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const secretSchema = z
  .string()
  .min(32)
  .max(4_096)
  .regex(/^[!-~]+$/);

export async function GET(request: Request) {
  const secret = secretSchema.safeParse(process.env.CRON_SECRET);
  if (!secret.success)
    return NextResponse.json(
      { error: "Maintenance is not configured" },
      { status: 503 },
    );
  const authorization = z
    .string()
    .max(4_103)
    .safeParse(request.headers.get("authorization"));
  if (
    !authorization.success ||
    !timingSafeEqual(
      createHash("sha256").update(authorization.data).digest(),
      createHash("sha256").update(`Bearer ${secret.data}`).digest(),
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = z
    .object({})
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success)
    return NextResponse.json(
      { error: "Invalid maintenance request" },
      { status: 400 },
    );
  try {
    const summary = await maintainYouTubeAuthorizations();
    return NextResponse.json(summary, {
      status:
        summary.failed || summary.retry || summary.removedUnconfirmed
          ? 503
          : 200,
    });
  } catch {
    return NextResponse.json(
      { error: "YouTube maintenance could not complete" },
      { status: 503 },
    );
  }
}
