import { NextResponse } from "next/server";
import { z } from "zod";
import { claimRole } from "@/lib/store";
import { issueParticipantToken, readAccessToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/rate-limit";
const schema = z.object({ token: z.string(), claimant: z.string().uuid() });
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const client =
      request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    if (!rateLimit(`claim:${id}:${client}`, 20))
      return NextResponse.json(
        { error: "Too many attempts. Wait a minute and try again." },
        { status: 429 },
      );
    const body = schema.parse(await request.json());
    const claims = await readAccessToken(body.token);
    if (claims.gameId !== id || claims.purpose !== "invitation" || !claims.role)
      throw new Error();
    const result = await claimRole(id, claims.role, body.claimant);
    return result.error
      ? NextResponse.json(result, { status: 409 })
      : NextResponse.json({
          role: claims.role,
          sessionToken: await issueParticipantToken(
            id,
            claims.role,
            body.claimant,
          ),
          expiresIn: 21_600,
        });
  } catch {
    return NextResponse.json(
      { error: "This link is invalid or expired." },
      { status: 401 },
    );
  }
}
