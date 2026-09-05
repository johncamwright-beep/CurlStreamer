import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadActiveTeam: vi.fn(),
  rpc: vi.fn(),
  terminateGameLiveKit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/team-games", () => ({ loadActiveTeam: mocks.loadActiveTeam }));
vi.mock("@/lib/providers/livekit", () => ({
  terminateGameLiveKit: mocks.terminateGameLiveKit,
}));

import { DELETE, PATCH, POST } from "./route";

const gameId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const request = (method: "DELETE" | "PATCH" | "POST") =>
  new Request(`http://test/api/games/${gameId}/deletion`, { method });
const context = { params: Promise.resolve({ id: gameId }) };

describe("atomic game deletion route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    mocks.loadActiveTeam.mockResolvedValue({
      kind: "ready",
      team: { organizationId: "team-1", role: "owner" },
    });
    mocks.terminateGameLiveKit.mockResolvedValue(undefined);
    mocks.rpc.mockImplementation(async (operation: string) => {
      if (operation === "soft_delete_team_game")
        return { data: true, error: null };
      if (operation === "restore_team_game") return { data: true, error: null };
      if (operation === "get_game_deletion_cleanup")
        return {
          data: [{ status: "pending", attempts: 0, last_error: null }],
          error: null,
        };
      return {
        data: [{ status: "complete", attempts: 1, last_error: null }],
        error: null,
      };
    });
  });

  it("commits deletion before separately confirming provider cleanup", async () => {
    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      changed: true,
      deletionCommitted: true,
      cleanup: { status: "complete", attempts: 1, lastError: null },
    });
    expect(mocks.terminateGameLiveKit).toHaveBeenCalledWith(gameId);
    expect(mocks.rpc.mock.calls.map(([operation]) => operation)).toEqual([
      "soft_delete_team_game",
      "get_game_deletion_cleanup",
      "record_game_deletion_cleanup",
    ]);
  });

  it("records cleanup failure truthfully and supports an idempotent retry", async () => {
    mocks.terminateGameLiveKit.mockRejectedValueOnce(new Error("provider"));
    mocks.rpc.mockImplementationOnce(async () => ({ data: true, error: null }));
    mocks.rpc.mockImplementationOnce(async () => ({
      data: [{ status: "pending", attempts: 0, last_error: null }],
      error: null,
    }));
    mocks.rpc.mockImplementationOnce(async () => ({
      data: [
        {
          status: "failed",
          attempts: 1,
          last_error: "LiveKit room shutdown was not confirmed",
        },
      ],
      error: null,
    }));
    const failed = await DELETE(request("DELETE"), context);
    expect(failed.status).toBe(202);
    expect(await failed.json()).toMatchObject({
      changed: true,
      deletionCommitted: true,
      cleanup: { status: "failed", attempts: 1 },
    });

    mocks.rpc.mockImplementationOnce(async () => ({
      data: false,
      error: null,
    }));
    mocks.rpc.mockImplementationOnce(async () => ({
      data: [{ status: "failed", attempts: 1, last_error: "prior" }],
      error: null,
    }));
    mocks.rpc.mockImplementationOnce(async () => ({
      data: [{ status: "complete", attempts: 2, last_error: null }],
      error: null,
    }));
    const retried = await DELETE(request("DELETE"), context);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      changed: false,
      deletionCommitted: true,
      cleanup: { status: "complete", attempts: 2 },
    });
  });

  it("distinguishes committed deletion from unavailable cleanup status", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "provider-status" },
    });

    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      changed: true,
      deletionCommitted: true,
      cleanup: { status: "pending" },
    });
  });

  it("does not claim deletion when neither the mutation nor cleanup row exists", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "The deleted game could not be found.",
    });
  });

  it("does not claim deletion when an unchanged mutation cannot be confirmed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "provider-status" },
    });

    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "The deletion status could not be confirmed. Try again.",
    });
  });

  it("does not repeat provider teardown after cleanup is complete", async () => {
    mocks.rpc.mockImplementationOnce(async () => ({
      data: false,
      error: null,
    }));
    mocks.rpc.mockImplementationOnce(async () => ({
      data: [{ status: "complete", attempts: 1, last_error: null }],
      error: null,
    }));

    expect((await DELETE(request("DELETE"), context)).status).toBe(200);
    expect(mocks.terminateGameLiveKit).not.toHaveBeenCalled();
  });

  it("retries cleanup without invoking the deletion mutation", async () => {
    const response = await PATCH(request("PATCH"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cleanup: { status: "complete", attempts: 1, lastError: null },
    });
    expect(mocks.terminateGameLiveKit).toHaveBeenCalledWith(gameId);
    expect(mocks.rpc.mock.calls.map(([operation]) => operation)).toEqual([
      "get_game_deletion_cleanup",
      "record_game_deletion_cleanup",
    ]);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "soft_delete_team_game",
      expect.anything(),
    );
  });

  it("cannot re-delete a game restored after a stale trash page loaded", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const response = await PATCH(request("PATCH"), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This game is no longer deleted.",
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("get_game_deletion_cleanup", {
      p_user_id: userId,
      p_game_id: gameId,
    });
    expect(mocks.terminateGameLiveKit).not.toHaveBeenCalled();
  });

  it("preserves the live-session conflict without claiming cleanup", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "stop live" },
    });

    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Stop the live session before deleting this game.",
    });
    expect(mocks.terminateGameLiveKit).not.toHaveBeenCalled();
  });

  it("restores metadata without running provider cleanup", async () => {
    const response = await POST(request("POST"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("restore_team_game", {
      p_user_id: userId,
      p_game_id: gameId,
    });
    expect(mocks.terminateGameLiveKit).not.toHaveBeenCalled();
  });

  it("retains owner and team-admin authorization", async () => {
    mocks.loadActiveTeam.mockResolvedValue({
      kind: "ready",
      team: { organizationId: "team-1", role: "scorer" },
    });

    expect((await DELETE(request("DELETE"), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("applies the owner/team-admin boundary to cleanup-only retry", async () => {
    mocks.loadActiveTeam.mockResolvedValue({
      kind: "ready",
      team: { organizationId: "team-1", role: "scorer" },
    });

    expect((await PATCH(request("PATCH"), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.terminateGameLiveKit).not.toHaveBeenCalled();
  });
});
