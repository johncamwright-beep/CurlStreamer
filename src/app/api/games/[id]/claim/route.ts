import { NextResponse } from "next/server";
import { z } from "zod";
import { claimRole } from "@/lib/store";
import { issueParticipantToken, readAccessToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/rate-limit";
import { authorizeGame } from "@/lib/game-authorization";
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
    if (
      claims.gameId !== id ||
      claims.purpose !== "invitation" ||
      !claims.role ||
      !claims.jti ||
      !claims.exp
    )
      throw new Error();
    const authorization = await authorizeGame(
      new Request(request.url, {
        headers: { authorization: `Bearer ${body.token}` },
      }),
      id,
      {
        accountRoles: [],
        tokenAllowed: (access) => access.purpose === "invitation",
      },
    );
    if (!authorization.ok)
      return NextResponse.json(
        {
          error:
            authorization.reason === "deleted"
              ? "This game is unavailable."
              : "This link is invalid or expired.",
        },
        { status: authorization.reason === "deleted" ? 410 : 401 },
      );
    const result = await claimRole(id, claims.role, body.claimant, {
      id: claims.jti,
      expectedGeneration: claims.assignmentGeneration,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    });
    return result.error
      ? NextResponse.json(result, { status: 409 })
      : NextResponse.json({
          role: claims.role,
          sessionToken: await issueParticipantToken(
            id,
            claims.role,
            body.claimant,
            result.generation,
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
