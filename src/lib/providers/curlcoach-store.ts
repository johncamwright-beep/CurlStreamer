import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  append,
  commandSchema,
  stateSchema,
  type Command,
  type State,
} from "@/lib/curlcoach/model";

const scopeSchema = z.object({
  organizationId: z.uuid(),
  gameId: z.uuid(),
  actorUserId: z.uuid(),
});

export type CurlCoachScope = z.infer<typeof scopeSchema>;
export type CurlCoachLifecycle = "finish" | "reopen";
type ProductionCoachState = State &
  Required<Pick<State, "revision" | "status" | "roster">>;

function validateScopedState(
  scope: CurlCoachScope,
  state: State,
): ProductionCoachState {
  const parsed = stateSchema.parse(state);
  if (
    parsed.organizationId !== scope.organizationId ||
    parsed.gameId !== scope.gameId
  )
    throw new Error("CurlCoach state scope mismatch");
  if (
    parsed.revision === undefined ||
    parsed.status === undefined ||
    parsed.roster === undefined
  )
    throw new Error("CurlCoach production state is incomplete");
  return parsed as ProductionCoachState;
}

function operationError(operation: string, error: unknown): never {
  const value = error as { code?: unknown; message?: unknown } | null;
  console.error("CurlCoach store unavailable", {
    operation,
    code: typeof value?.code === "string" ? value.code : "unknown",
  });
  throw new Error("CurlCoach private storage unavailable");
}

async function apply(
  scope: CurlCoachScope,
  requestId: string,
  expectedRevision: number,
  commandType: "command" | CurlCoachLifecycle,
  payload: Record<string, unknown>,
  nextState: State,
) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "apply_curlcoach_command",
    {
      p_actor_user_id: scope.actorUserId,
      p_organization_id: scope.organizationId,
      p_game_id: scope.gameId,
      p_request_id: requestId,
      p_expected_revision: expectedRevision,
      p_command_type: commandType,
      p_payload: payload,
      p_next_state: nextState,
    },
  );
  if (error) return operationError(commandType, error);
  return validateScopedState(scope, data as State);
}

/** Reads only the authenticated actor's private session; an absent session is local state. */
export async function loadCoachState(
  scopeInput: CurlCoachScope,
  initialState: State,
) {
  const scope = scopeSchema.parse(scopeInput);
  const initial = validateScopedState(scope, initialState);
  const { data, error } = await createAdminSupabaseClient().rpc(
    "read_curlcoach_state",
    {
      p_actor_user_id: scope.actorUserId,
      p_organization_id: scope.organizationId,
      p_game_id: scope.gameId,
    },
  );
  if (error) return operationError("read", error);
  return data === null ? initial : validateScopedState(scope, data as State);
}

/** Derives the next shot snapshot server-side, then commits it atomically with CAS. */
export async function saveCoachState(
  scopeInput: CurlCoachScope,
  state: State,
  commandInput: Command,
) {
  const scope = scopeSchema.parse(scopeInput);
  const current = validateScopedState(scope, state);
  const command = commandSchema.parse(commandInput);
  if (
    command.shot &&
    !current.roster.some((entry) => entry.id === command.shot!.playerId)
  )
    throw new Error("Attempt player is not in this coaching roster.");
  const next = append(current, command, scope.actorUserId);
  return apply(
    scope,
    command.requestId,
    command.expectedRevision,
    "command",
    command,
    validateScopedState(scope, next),
  );
}

/** Finish and reopen are private session lifecycle events; game state is untouched. */
export async function transitionCoachState(
  scopeInput: CurlCoachScope,
  state: State,
  action: CurlCoachLifecycle,
  requestId: string,
  expectedRevision: number,
) {
  const scope = scopeSchema.parse(scopeInput);
  const current = validateScopedState(scope, state);
  const desiredStatus = action === "finish" ? "closed" : "open";
  // A response can be lost after the database commits. Send the original
  // request through so its immutable command record, rather than a local
  // status check, resolves that idempotent retry.
  const isCommittedRetry =
    current.revision === expectedRevision + 1 &&
    current.status === desiredStatus;
  if (!isCommittedRetry && current.revision !== expectedRevision)
    throw new Error("Report changed. Reload before changing coaching status.");
  if (!isCommittedRetry && action === "finish" && current.status !== "open")
    throw new Error("Coaching is already finished.");
  if (!isCommittedRetry && action === "reopen" && current.status !== "closed")
    throw new Error("Coaching is already open.");
  const next = isCommittedRetry
    ? current
    : ({
        ...current,
        status: desiredStatus,
        revision: current.revision + 1,
      } as State);
  return apply(
    scope,
    z.uuid().parse(requestId),
    expectedRevision,
    action,
    { requestId, expectedRevision, action },
    validateScopedState(scope, next),
  );
}
