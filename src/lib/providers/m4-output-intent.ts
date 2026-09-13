import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  m4DesktopEnabled,
  type M4DesktopCredential,
} from "./m4-desktop-authority";

const id = z.uuid();
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const authority = z
  .object({
    sessionId: id,
    generation,
    bearer: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
const row = z
  .object({
    intent_id: id,
    session_id: id,
    generation: z.coerce.number().pipe(generation),
    phase: z.enum(["reserved", "quarantined", "stop_requested"]),
    delivery_recorded: z.boolean(),
  })
  .refine(
    (value) =>
      value.phase === "stop_requested" ||
      (value.phase === "quarantined"
        ? value.delivery_recorded
        : !value.delivery_recorded),
  );

/**
 * Reserves a durable intent only. It does not return a destination or grant
 * permission to start OBS. Delivery quarantine is not cleared by client stop.
 * The service-only SQL delivery barrier deliberately has no TypeScript caller
 * or HTTP route until the native memory bridge and once-only handoff are ready.
 */
export async function claimM4OutputIntent(
  gameId: string,
  credential: M4DesktopCredential,
  intentId: string,
) {
  try {
    if (!m4DesktopEnabled()) throw new Error("m4_output_intent_unavailable");
    id.parse(gameId);
    id.parse(intentId);
    const parsed = authority.parse(credential);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "claim_m4_output_intent",
      {
        p_game_id: gameId,
        p_session_id: parsed.sessionId,
        p_generation: parsed.generation,
        p_bearer_hash: createHash("sha256").update(parsed.bearer).digest("hex"),
        p_intent_id: intentId,
      },
    );
    if (error)
      throw Object.assign(new Error("m4_output_intent_unavailable"), {
        ...(error.code === "42501" || error.code === "55000"
          ? { code: error.code }
          : {}),
      });
    const value = z.array(row).length(1).parse(data)[0];
    if (
      value.intent_id !== intentId ||
      value.session_id !== parsed.sessionId ||
      value.generation !== parsed.generation
    )
      throw new Error("m4_output_intent_unavailable");
    return {
      intentId: value.intent_id,
      sessionId: value.session_id,
      generation: value.generation,
      phase: value.phase,
      deliveryRecorded: value.delivery_recorded,
    };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw Object.assign(
      new Error("m4_output_intent_unavailable"),
      code === "42501" || code === "55000" ? { code } : {},
    );
  }
}
