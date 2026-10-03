import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  completionActorParameters,
  type CompletionCredential,
} from "@/lib/game-completion";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const id = z.uuid();
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });
const pairingRow = z.object({
  session_id: id,
  generation: z.coerce.number().pipe(generation),
  expires_at: instant,
});
const sessionRow = pairingRow.extend({ lease_expires_at: instant });
const heartbeatRow = sessionRow.extend({
  desired_action: z.enum(["wait", "stop"]),
});
const authority = z
  .object({ sessionId: id, generation, bearer: secret })
  .strict();
export type M4DesktopCredential = z.infer<typeof authority>;

export function m4DesktopEnabled() {
  return process.env.CURLCAST_M4_LOCAL_YOUTUBE === "disposable";
}
function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function randomSecret() {
  return randomBytes(32).toString("base64url");
}

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Input/schema/provider errors can contain supplied secrets. Never relay them.
    const code = (error as { code?: unknown } | null)?.code;
    throw Object.assign(
      new Error("m4_desktop_unavailable"),
      code === "42501" || code === "55000" ? { code } : {},
    );
  }
}
async function rpc<T>(
  name: string,
  parameters: Record<string, unknown>,
  schema: z.ZodType<T>,
) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    name,
    parameters,
  );
  if (error)
    throw Object.assign(new Error("m4_desktop_unavailable"), {
      ...(error.code === "42501" || error.code === "55000"
        ? { code: error.code }
        : {}),
    });
  return z.array(schema).length(1).parse(data)[0];
}
function enabled() {
  if (!m4DesktopEnabled()) throw new Error("m4_desktop_unavailable");
}
function safeSession(row: z.infer<typeof sessionRow>) {
  return {
    sessionId: row.session_id,
    generation: row.generation,
    expiresAt: row.expires_at,
    leaseExpiresAt: row.lease_expires_at,
  };
}

/** Manager approval conveys a pairing code, never desktop or stream credentials. */
export async function approveM4DesktopPairing(
  gameId: string,
  credential: CompletionCredential,
  challenge: string,
) {
  return guarded(async () => {
    enabled();
    id.parse(gameId);
    hash.parse(challenge);
    const actor = await completionActorParameters(gameId, credential);
    const code = randomSecret();
    const row = await rpc(
      "approve_m4_desktop_pairing",
      {
        p_game_id: gameId,
        ...actor,
        p_code_hash: digest(code),
        p_challenge_hash: challenge,
      },
      pairingRow,
    );
    return {
      code,
      sessionId: row.session_id,
      generation: row.generation,
      expiresAt: row.expires_at,
    };
  });
}

/**
 * One-use verifier-bound exchange. Database stores only bearer hash. Losing this
 * response requires fresh authorized pairing, not replay or secret persistence.
 * This capability cannot fetch stream credentials: no target/start API exists.
 */
export async function exchangeM4DesktopPairing(
  gameId: string,
  code: string,
  verifier: string,
) {
  return guarded(async () => {
    enabled();
    id.parse(gameId);
    secret.parse(code);
    secret.parse(verifier);
    const bearer = randomSecret();
    const row = await rpc(
      "exchange_m4_desktop_pairing",
      {
        p_game_id: gameId,
        p_code_hash: digest(code),
        p_challenge_hash: digest(verifier),
        p_bearer_hash: digest(bearer),
      },
      sessionRow,
    );
    return { ...safeSession(row), bearer };
  });
}

async function desktopAction(
  gameId: string,
  credential: M4DesktopCredential,
  action: "heartbeat" | "stop",
) {
  return guarded(async () => {
    if (action === "heartbeat") enabled();
    id.parse(gameId);
    const parsed = authority.parse(credential);
    const row = await rpc(
      action === "heartbeat" ? "heartbeat_m4_desktop" : "stop_m4_desktop",
      {
        p_game_id: gameId,
        p_session_id: parsed.sessionId,
        p_generation: parsed.generation,
        p_bearer_hash: digest(parsed.bearer),
      },
      heartbeatRow,
    );
    if (
      row.session_id !== parsed.sessionId ||
      row.generation !== parsed.generation ||
      (action === "stop" && row.desired_action !== "stop")
    )
      throw new Error("m4_desktop_unavailable");
    return { ...safeSession(row), desiredAction: row.desired_action };
  });
}
export function heartbeatM4Desktop(
  gameId: string,
  credential: M4DesktopCredential,
) {
  return desktopAction(gameId, credential, "heartbeat");
}
export function stopM4Desktop(gameId: string, credential: M4DesktopCredential) {
  return desktopAction(gameId, credential, "stop");
}
