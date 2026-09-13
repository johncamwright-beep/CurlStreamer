import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  studioAction,
  StudioRejected,
  StudioUnavailable,
} from "./m2-studio-session";
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
function signingKey() {
  const secret = process.env.ROLE_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new StudioUnavailable();
  return createHmac("sha256", secret)
    .update("curlcast-m3-program-cookie-v1")
    .digest();
}
function grantHash(code: string) {
  return createHash("sha256").update(code).digest("hex");
}
export async function createProgramGrant(scope: ProgramScope) {
  signingKey();
  const validated = scopeSchema.parse(scope);
  const code = randomBytes(32).toString("base64url");
  // At most one pending grant per game. Only its digest is stored, never the URL.
  const { error } = await createAdminSupabaseClient()
    .from("m3_program_grants")
    .upsert(
      {
        game_id: validated.gameId,
        code_hash: grantHash(code),
        scope: validated,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      },
      { onConflict: "game_id" },
    );
  if (error) throw new StudioUnavailable("database");
  return code;
}
export async function exchangeProgramGrant(gameId: string, code: string) {
  const key = signingKey();
  // DELETE RETURNING consumes atomically across processes, even concurrent requests.
  const { data, error } = await createAdminSupabaseClient()
    .from("m3_program_grants")
    .delete()
    .eq("game_id", gameId)
    .eq("code_hash", grantHash(code))
    .gt("expires_at", new Date().toISOString())
    .select("scope")
    .maybeSingle();
  if (error) throw new StudioUnavailable("database");
  const parsed = scopeSchema.safeParse(data?.scope);
  if (!parsed.success || parsed.data.gameId !== gameId)
    throw new StudioRejected();
  await checkProgramScope(parsed.data);
  return new SignJWT({ scope: parsed.data })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("curlcast-m3-program")
    .setIssuedAt()
    .setExpirationTime(`${programCookieSeconds}s`)
    .sign(key);
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
    const { payload } = await jwtVerify(value, signingKey(), {
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
