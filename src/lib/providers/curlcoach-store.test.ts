import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  append,
  emptyState,
  type Command,
  type State,
} from "@/lib/curlcoach/model";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

import {
  loadCoachState,
  saveCoachState,
  transitionCoachState,
  type CurlCoachScope,
} from "./curlcoach-store";

const scope: CurlCoachScope = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  gameId: "10000000-0000-4000-8000-000000000002",
  actorUserId: "10000000-0000-4000-8000-000000000003",
};

function state(overrides: Partial<State> = {}): State {
  return {
    ...emptyState(),
    organizationId: scope.organizationId,
    gameId: scope.gameId,
    roster: [{ id: "lead", name: "Avery", position: "Lead" }],
    revision: 0,
    status: "open",
    ...overrides,
  };
}

function command(): Command {
  return {
    requestId: "10000000-0000-4000-8000-000000000004",
    expectedRevision: 0,
    shotId: "10000000-0000-4000-8000-000000000005",
    shot: {
      playerId: "lead",
      position: "Lead",
      end: 1,
      stone: 1,
      type: "Draw",
      turn: null,
      execution: null,
      grade: 4,
      deficiency: null,
      review: null,
      excluded: null,
      note: "Private note",
    },
  };
}

beforeEach(() => rpc.mockReset());

describe("CurlCoach private store", () => {
  it("returns supplied canonical state only when the actor has no private session", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(loadCoachState(scope, state())).resolves.toMatchObject({
      roster: [{ name: "Avery" }],
      revision: 0,
      status: "open",
    });
    expect(rpc).toHaveBeenCalledWith("read_curlcoach_state", {
      p_actor_user_id: scope.actorUserId,
      p_organization_id: scope.organizationId,
      p_game_id: scope.gameId,
    });
  });

  it("derives the next shot snapshot server-side and sends the complete CAS request", async () => {
    const initial = state();
    rpc.mockResolvedValue({
      data: append(initial, command(), scope.actorUserId),
      error: null,
    });
    const result = await saveCoachState(scope, initial, command());
    expect(result).toMatchObject({ revision: 1, status: "open" });
    expect(result.events).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      "apply_curlcoach_command",
      expect.objectContaining({
        p_actor_user_id: scope.actorUserId,
        p_request_id: command().requestId,
        p_expected_revision: 0,
        p_command_type: "command",
      }),
    );
  });

  it("sends an already-committed finish retry to the durable request-id boundary", async () => {
    const committed = state({ revision: 1, status: "closed" });
    rpc.mockResolvedValue({ data: committed, error: null });
    await expect(
      transitionCoachState(
        scope,
        committed,
        "finish",
        "10000000-0000-4000-8000-000000000006",
        0,
      ),
    ).resolves.toMatchObject({ revision: 1, status: "closed" });
    expect(rpc).toHaveBeenCalledWith(
      "apply_curlcoach_command",
      expect.objectContaining({
        p_command_type: "finish",
        p_expected_revision: 0,
        p_next_state: committed,
      }),
    );
  });

  it("rejects a shot for a player outside the stored roster before it reaches SQL", async () => {
    const invalid = {
      ...command(),
      shot: { ...command().shot!, playerId: "not-on-this-team" },
    };
    await expect(saveCoachState(scope, state(), invalid)).rejects.toThrow(
      "not in this coaching roster",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
