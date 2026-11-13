import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  append,
  commandSchema,
  currentShots,
  stateSchema,
  type Command,
  type State,
} from "@/lib/curlcoach/model";
import {
  contextSchema,
  preferencesSchema,
  supplementSchema,
  standardConflicts,
  validateShotReferences,
  groups,
  type EnhancedRecord,
  type Supplement,
} from "@/lib/curlcoach/enhanced-catalog";
import type { CurlCoachScope } from "./curlcoach-store";

export type EnhancedDocument = EnhancedRecord<unknown> & {
  kind: "preferences" | "context" | "supplement";
  shotId?: string;
};
export const documentWriteSchema = z
  .object({
    kind: z.enum(["preferences", "context", "supplement"]),
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    sourceRevision: z.number().int().nonnegative(),
    shotId: z.uuid().optional(),
    value: z.unknown(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const result = (
      v.kind === "preferences"
        ? preferencesSchema
        : v.kind === "context"
          ? contextSchema
          : supplementSchema
    ).safeParse(v.value);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: "custom", message: issue.message });
    if ((v.kind === "supplement") !== !!v.shotId)
      ctx.addIssue({
        code: "custom",
        message: "Supplement requires its source shot identity.",
      });
  });
export type DocumentWrite = z.infer<typeof documentWriteSchema>;
export function supplementConflicts(
  doc: EnhancedDocument,
  state: State,
): string[] {
  if (doc.kind !== "supplement") return [];
  const history = state.events.filter((e) => e.shotId === doc.shotId);
  const current = history.at(-1)?.shot;
  if (!current) return ["source shot deleted"];
  const original = history.find((e) => e.revision === doc.sourceRevision)?.shot;
  if (
    !original ||
    original.playerId !== current.playerId ||
    original.position !== current.position ||
    original.end !== current.end ||
    original.stone !== current.stone
  )
    return ["source identity requires reconciliation"];
  const value = supplementSchema.parse(doc.value);
  const conflicts = standardConflicts(value, current);
  for (const field of ["line", "release", "technical", "deficiency"] as const)
    if (
      value.assessments[field] &&
      value.assessments[field] !== "not_assessed" &&
      (original[field] ?? null) !== (current[field] ?? null)
    )
      conflicts.push(field);
  return [...new Set(conflicts)];
}
/** Prompt 2 consumes this projection: conflicts retain history but cannot enter rates. */
export function eligibleSupplement(doc: EnhancedDocument, state: State) {
  const value = supplementSchema.parse(doc.value);
  const conflicts = supplementConflicts(doc, state);
  const unavailableGroups = groups.filter(
    (group) =>
      conflicts.includes(group) ||
      conflicts.some((c) => c.startsWith("source ")),
  );
  return { value, unavailableGroups, conflicts };
}
export async function loadEnhanced(
  scope: Omit<CurlCoachScope, "gameId"> & { gameId?: string },
  state?: State,
): Promise<EnhancedDocument[]> {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "read_shot_tracker_enhanced",
    {
      p_actor: scope.actorUserId,
      p_org: scope.organizationId,
      p_game: scope.gameId ?? null,
    },
  );
  if (error) throw new Error("Enhanced storage unavailable.");
  return (data as EnhancedDocument[]).map((d) => ({
    ...d,
    conflicts: state ? supplementConflicts(d, state) : [],
  }));
}
export async function saveEnhanced(
  scope: Omit<CurlCoachScope, "gameId"> & { gameId?: string },
  input: DocumentWrite,
  state?: State,
  standard?: Command,
) {
  const write = documentWriteSchema.parse(input);
  let next: State | undefined;
  if (standard) {
    const command = commandSchema.parse(standard);
    if (
      !state ||
      !command.shot ||
      command.shotId !== write.shotId ||
      command.requestId !== write.requestId
    )
      throw new Error("Invalid combined shot save.");
    if (!state.roster?.some((p) => p.id === command.shot!.playerId))
      throw new Error("Attempt player is not in this coaching roster.");
    next = stateSchema.parse(append(state, command, scope.actorUserId));
  }
  if (write.kind === "supplement") {
    const shot = (next ?? state)?.events
      .filter((e) => e.shotId === write.shotId)
      .at(-1)?.shot;
    if (!shot) throw new Error("Shot unavailable.");
    validateShotReferences(
      write.value as Supplement,
      write.shotId!,
      currentShots((next ?? state)!.events),
    );
    const conflicts = standardConflicts(write.value as Supplement, shot);
    if (conflicts.length)
      throw new Error(
        `Review the Standard ${conflicts.join(", ")} observation before assessing it.`,
      );
  }
  const { data, error } = await createAdminSupabaseClient().rpc(
    "save_shot_tracker_enhanced",
    {
      p_actor: scope.actorUserId,
      p_org: scope.organizationId,
      p_game: scope.gameId ?? null,
      p_shot: write.shotId ?? null,
      p_kind: write.kind,
      p_request: write.requestId,
      p_expected: write.expectedRevision,
      p_source_revision: write.sourceRevision,
      p_value: write.value,
      p_standard_command: standard ?? null,
      p_next_state: next ?? null,
    },
  );
  if (error)
    throw new Error(
      "Save not confirmed: refresh to check for a source or Enhanced revision conflict.",
    );
  return data as EnhancedRecord & { state: State | null };
}
