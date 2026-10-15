import { NextResponse } from "next/server";
import { z } from "zod";
import { savePilotInterest } from "@/lib/providers/pilot-waitlist";

const schema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  team: z.string().trim().max(120).default(""),
  consent: z.literal(true),
  website: z.string().max(200).default(""),
});
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Please submit the form from the CurlStreamer website." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 4096)
    return NextResponse.json(
      { error: "The request is too large." },
      { status: 413 },
    );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return NextResponse.json(
          { error: "The request is too large." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Check your email and try again." },
      { status: 400 },
    );
  }
  const body = schema.safeParse(json);
  if (!body.success)
    return NextResponse.json(
      { error: "Enter a valid email and agree to receive pilot updates." },
      { status: 400 },
    );
  if (body.data.website) return NextResponse.json({ ok: true });
  try {
    const client =
      request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "local";
    const result = await savePilotInterest(
      body.data.email,
      body.data.team,
      client,
    );
    if (result === "limited")
      return NextResponse.json(
        { error: "Too many requests. Please try again in an hour." },
        { status: 429 },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "We couldn’t save your request right now. Please try again shortly.",
      },
      { status: 503 },
    );
  }
}
