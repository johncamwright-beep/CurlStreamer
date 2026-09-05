import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  claimRole: vi.fn(),
  issueParticipantToken: vi.fn(),
  readAccessToken: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/store", () => ({ claimRole: mocks.claimRole }));
vi.mock("@/lib/tokens", () => ({
  issueParticipantToken: mocks.issueParticipantToken,
  readAccessToken: mocks.readAccessToken,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/game-authorization", () => ({
  authorizeGame: mocks.authorizeGame,
}));

import { POST } from "./route";

const invitationId = "11111111-1111-4111-8111-111111111111";
const claimant = "22222222-2222-4222-8222-222222222222";
const request = () =>
  new Request("http://test/api/games/game-1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "signed-invitation", claimant }),
  });

describe("atomic role claim route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rateLimit.mockReturnValue(true);
    mocks.readAccessToken.mockResolvedValue({
      gameId: "game-1",
      purpose: "invitation",
      role: "camera-home",
      jti: invitationId,
      assignmentGeneration: 4,
      exp: Math.floor(Date.now() / 1000) + 1800,
    });
    mocks.authorizeGame.mockResolvedValue({ ok: true, via: "token" });
    mocks.claimRole.mockResolvedValue({ generation: 4, game: { claims: {} } });
    mocks.issueParticipantToken.mockResolvedValue("participant-session");
  });

  it("atomically consumes the signed invitation and binds the session generation", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.claimRole).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      claimant,
      {
        id: invitationId,
        expectedGeneration: 4,
        expiresAt: expect.any(String),
      },
    );
    expect(mocks.issueParticipantToken).toHaveBeenCalledWith(
      "game-1",
      "camera-home",
      claimant,
      4,
    );
  });

  it("returns a conflict for stale or already-consumed invitations", async () => {
    mocks.claimRole.mockResolvedValue({ error: "This invitation is stale." });
    const response = await POST(request(), {
      params: Promise.resolve({ id: "game-1" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.issueParticipantToken).not.toHaveBeenCalled();
  });
});
