import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadActiveTeam: vi.fn(),
  listTeamGames: vi.fn(),
  listDeletedTeamGames: vi.fn(),
  getGame: vi.fn(),
  readAccessToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/team-games", () => ({
  loadActiveTeam: mocks.loadActiveTeam,
  listTeamGames: mocks.listTeamGames,
  listDeletedTeamGames: mocks.listDeletedTeamGames,
}));
vi.mock("@/lib/store", () => ({ getGame: mocks.getGame }));
vi.mock("@/lib/tokens", () => ({ readAccessToken: mocks.readAccessToken }));

import {
  authorizationError,
  authorizeGame,
  operatorRoles,
} from "./game-authorization";

const request = (token?: string) =>
  new Request("https://curlcast-feature.vercel.app/api/games/scheduled-game", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const options = {
  accountRoles: operatorRoles,
  tokenAllowed: (access: { purpose: string }) => access.purpose === "organizer",
};

describe("game authorization lookup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-user" } },
    });
    mocks.loadActiveTeam.mockResolvedValue({
      kind: "ready",
      team: { organizationId: "team-1", role: "owner" },
    });
    mocks.listTeamGames.mockResolvedValue({
      ok: true,
      games: [{ game_id: "scheduled-game", game_status: "active" }],
    });
    mocks.listDeletedTeamGames.mockResolvedValue({ ok: true, games: [] });
  });

  it("authorizes a current scheduled game through the account RPC boundary", async () => {
    await expect(
      authorizeGame(request(), "scheduled-game", options),
    ).resolves.toEqual({
      ok: true,
      via: "account",
      role: "owner",
      organizationId: "team-1",
    });
    expect(mocks.listTeamGames).toHaveBeenCalledWith({ id: "verified-user" });
    expect(mocks.getGame).not.toHaveBeenCalled();
  });

  it("retains organizer-token access without an account session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.readAccessToken.mockResolvedValue({
      gameId: "scheduled-game",
      purpose: "organizer",
    });
    mocks.getGame.mockResolvedValue({ status: "active" });
    await expect(
      authorizeGame(request("organizer"), "scheduled-game", options),
    ).resolves.toMatchObject({
      ok: true,
      via: "token",
    });
  });

  it("accepts only the current device-bound participant claim", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.readAccessToken.mockResolvedValue({
      gameId: "scheduled-game",
      purpose: "participant",
      role: "camera-home",
      deviceId: "device-1",
    });
    mocks.getGame.mockResolvedValue({
      status: "active",
      claims: { "camera-home": "device-1" },
    });
    const participantOptions = {
      ...options,
      tokenAllowed: (access: { purpose: string }) =>
        access.purpose === "participant",
    };
    await expect(
      authorizeGame(
        request("participant"),
        "scheduled-game",
        participantOptions,
      ),
    ).resolves.toMatchObject({ ok: true, via: "token" });
    mocks.getGame.mockResolvedValue({
      status: "active",
      claims: { "camera-home": "replacement-device" },
    });
    await expect(
      authorizeGame(
        request("participant"),
        "scheduled-game",
        participantOptions,
      ),
    ).resolves.toEqual({ ok: false, reason: "released" });
  });

  it.each([
    ["database failure", { ok: false }, "unavailable", 503],
    [
      "closed game",
      {
        ok: true,
        games: [{ game_id: "scheduled-game", game_status: "closed" }],
      },
      "closed",
      410,
    ],
  ])(
    "distinguishes %s from a missing game",
    async (_label, listing, reason, status) => {
      mocks.listTeamGames.mockResolvedValue(listing);
      const result = await authorizeGame(request(), "scheduled-game", options);
      expect(result).toEqual({ ok: false, reason });
      if (!result.ok) expect(authorizationError(result).status).toBe(status);
    },
  );

  it("distinguishes deleted, missing, and cross-team games", async () => {
    mocks.listTeamGames.mockResolvedValue({ ok: true, games: [] });
    mocks.listDeletedTeamGames.mockResolvedValueOnce({
      ok: true,
      games: [{ game_id: "scheduled-game" }],
    });
    await expect(
      authorizeGame(request(), "scheduled-game", options),
    ).resolves.toEqual({
      ok: false,
      reason: "deleted",
    });

    mocks.listDeletedTeamGames.mockResolvedValue({ ok: true, games: [] });
    mocks.getGame
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: "active" });
    await expect(
      authorizeGame(request(), "scheduled-game", options),
    ).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
    await expect(
      authorizeGame(request(), "scheduled-game", options),
    ).resolves.toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});
