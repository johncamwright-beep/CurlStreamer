import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  issueSession,
  labEnabled,
  sameOrigin,
  sessionCookie,
} from "@/lib/curlcoach/access";

export async function POST(request: Request) {
  if (!labEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const input = z
    .object({ key: z.string().max(256) })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Enter the local lab key." },
      { status: 400 },
    );
  const supplied = Buffer.from(input.data.key);
  const expected = Buffer.from(process.env.CURLCOACH_LAB_SECRET!);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return NextResponse.json(
      { error: "Invalid local lab key." },
      { status: 401 },
    );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie, await issueSession(), {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 14400,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
