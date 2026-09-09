import "server-only";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { studioAction, StudioRejected } from "./m2-studio-session";
import type { CameraRole, StudioTicket } from "@/lib/m2-studio-protocol";

export const programCookieName = "curlcast_m3_program";
export const programCookieSeconds = 4 * 60 * 60;
const scopeSchema = z
  .object({
    gameId: z.uuid(),
    organizationId: z.uuid(),
    sessions: z
      .object({ "camera-home": z.uuid(), "camera-away": z.uuid() })
      .strict(),
  })
  .strict();
export type ProgramScope = z.infer<typeof scopeSchema>;
// Disposable single-process proof. Restart destroys all grants and cookie authority.
const signingKey = randomBytes(32);
const grants = new Map<string, { scope: ProgramScope; expiresAt: number }>();
export function createProgramGrant(scope: ProgramScope) {
  const now = Date.now();
  for (const [code, grant] of grants)
    if (grant.expiresAt <= now) grants.delete(code);
  if (grants.size >= 100) throw new StudioRejected();
  const code = randomBytes(32).toString("base64url");
  grants.set(code, {
    scope: scopeSchema.parse(scope),
    expiresAt: now + 300_000,
  });
  return code;
}
export async function exchangeProgramGrant(gameId: string, code: string) {
  const grant = grants.get(code);
  if (!grant || grant.expiresAt <= Date.now() || grant.scope.gameId !== gameId)
    throw new StudioRejected();
  // Delete synchronously before any await: concurrent exchanges cannot both win.
  grants.delete(code);
  await checkProgramScope(grant.scope);
  return new SignJWT({ scope: grant.scope })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("curlcast-m3-program")
    .setIssuedAt()
    .setExpirationTime(`${programCookieSeconds}s`)
    .sign(signingKey);
}
export async function readProgramScope(request: Request, gameId: string) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(programCookieName + "="))
    ?.slice(programCookieName.length + 1);
  if (!value) throw new StudioRejected();
  try {
    const { payload } = await jwtVerify(value, signingKey, {
      algorithms: ["HS256"],
      audience: "curlcast-m3-program",
    });
    const scope = scopeSchema.parse(payload.scope);
    if (scope.gameId !== gameId) throw new StudioRejected();
    return scope;
  } catch {
    throw new StudioRejected();
  }
}
export async function checkProgramScope(scope: ProgramScope) {
  await Promise.all(
    (Object.keys(scope.sessions) as CameraRole[]).map((cameraRole) =>
      studioAction(
        scope.gameId,
        {
          action: "check",
          side: "receiver",
          cameraRole,
          sessionId: scope.sessions[cameraRole],
        },
        { organizationId: scope.organizationId },
      ),
    ),
  );
}
export async function checkAvailableProgramScope(scope: ProgramScope) {
  const results = await Promise.allSettled(
    (Object.keys(scope.sessions) as CameraRole[]).map((cameraRole) =>
      studioAction(
        scope.gameId,
        {
          action: "check",
          side: "receiver",
          cameraRole,
          sessionId: scope.sessions[cameraRole],
        },
        { organizationId: scope.organizationId },
      ),
    ),
  );
  // Each slot independently checks active game/org and its fixed session in SQL.
  // A failed camera must not remove the healthy camera's score/sponsor canvas.
  if (!results.some((result) => result.status === "fulfilled"))
    throw new StudioRejected();
}
export async function prepareProgramScope(
  gameId: string,
  organizationId?: string,
) {
  const sessions = {} as Record<CameraRole, StudioTicket>;
  try {
    for (const cameraRole of ["camera-home", "camera-away"] as const)
      sessions[cameraRole] = await studioAction(
        gameId,
        { action: "register", side: "receiver", cameraRole },
        { organizationId },
      );
    const { data, error } = await createAdminSupabaseClient()
      .from("m2_studio_sessions")
      .select("organization_id")
      .eq("game_id", gameId)
      .eq("id", sessions["camera-home"].sessionId)
      .single();
    if (error || !z.uuid().safeParse(data?.organization_id).success)
      throw new StudioRejected();
    const scope = scopeSchema.parse({
      gameId,
      organizationId: data.organization_id,
      sessions: {
        "camera-home": sessions["camera-home"].sessionId,
        "camera-away": sessions["camera-away"].sessionId,
      },
    });
    await checkProgramScope(scope);
    return { scope, sessions };
  } catch (cause) {
    await Promise.allSettled(
      Object.entries(sessions).map(([cameraRole, ticket]) =>
        studioAction(
          gameId,
          {
            action: "stop",
            side: "receiver",
            cameraRole: cameraRole as CameraRole,
            sessionId: ticket.sessionId,
          },
          { organizationId },
        ),
      ),
    );
    throw cause;
  }
}
