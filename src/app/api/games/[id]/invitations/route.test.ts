import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  getGame: vi.fn(),
  issueChooserToken: vi.fn(),
  issueRoleToken: vi.fn(),
}));

vi.mock("@/lib/game-authorization", () => ({
  operatorRoles: ["owner", "team_admin", "scorer"],
  authorizeGame: mocks.authorizeGame,
  authorizationError: (result: { reason: string }) => ({
    error:
      result.reason === "deleted"
        ? "This game has been deleted"
        : "Game access is required",
    status: result.reason === "deleted" ? 410 : 401,
  }),
}));
vi.mock("@/lib/store", () => ({ getGame: mocks.getGame }));
vi.mock("@/lib/tokens", () => ({
  issueChooserToken: mocks.issueChooserToken,
  issueRoleToken: mocks.issueRoleToken,
}));

import { POST } from "./route";

function request(role: string, origin = "https://preview-curlcast.vercel.app") {
  return new Request(`${origin}/api/games/game-1/invitations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer credential",
    },
    body: JSON.stringify({ role }),
  });
}

describe("game invitations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "account",
      role: "team_admin",
      organizationId: "team-1",
    });
    mocks.getGame.mockResolvedValue({ status: "active" });
    mocks.issueChooserToken.mockResolvedValue("chooser-secret");
    mocks.issueRoleToken.mockResolvedValue("role-secret");
  });

  it.each([
    [
      "account authorization",
      { ok: true, via: "account", role: "owner", organizationId: "team-1" },
    ],
    [
      "organizer-token authorization",
      {
        ok: true,
        via: "token",
        access: { purpose: "organizer", gameId: "game-1" },
      },
    ],
  ])(
    "issues a chooser for an active game with %s",
    async (_label, authorization) => {
      mocks.authorizeGame.mockResolvedValue(authorization);
      const response = await POST(request("chooser"), {
        params: Promise.resolve({ id: "game-1" }),
      });
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(result.url).toBe(
        "https://preview-curlcast.vercel.app/join/game-1?chooser=chooser-secret",
      );
      expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    },
  );

  it("lets a public chooser exchange its token for every participant role", async () => {
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "token",
      access: { purpose: "invitation", gameId: "game-1" },
    });
    for (const role of ["camera-home", "camera-away", "scorer"]) {
      const response = await POST(request(role), {
        params: Promise.resolve({ id: "game-1" }),
      });
      expect(response.status).toBe(200);
      expect(mocks.issueRoleToken).toHaveBeenLastCalledWith("game-1", role);
    }
  });

  it("does not let chooser, participant, unauthorized, deleted, or closed access mint a chooser", async () => {
    for (const authorization of [
      {
        ok: true,
        via: "token",
        access: { purpose: "invitation", gameId: "game-1" },
      },
      { ok: false, reason: "unauthorized" },
      { ok: false, reason: "deleted" },
    ]) {
      mocks.authorizeGame.mockResolvedValueOnce(authorization);
      const response = await POST(request("chooser"), {
        params: Promise.resolve({ id: "game-1" }),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "account",
      role: "owner",
      organizationId: "team-1",
    });
    mocks.getGame.mockResolvedValue({ status: "closed" });
    expect(
      (
        await POST(request("chooser"), {
          params: Promise.resolve({ id: "game-1" }),
        })
      ).status,
    ).toBe(410);
    expect(mocks.issueChooserToken).not.toHaveBeenCalled();
  });
});
