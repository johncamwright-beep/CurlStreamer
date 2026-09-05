import { beforeEach, describe, expect, it, vi } from "vitest";

const gameId = "11111111-1111-4111-8111-111111111111";
const otherGameId = "22222222-2222-4222-8222-222222222222";
const account = { kind: "account", userId: "verified-owner" };
const mocks = vi.hoisted(() => ({
  verified: vi.fn(),
  readToken: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  configured: vi.fn(),
}));

vi.mock("@/lib/game-completion", () => ({
  verifiedCompletionAccount: mocks.verified,
}));
vi.mock("@/lib/tokens", () => ({ readAccessToken: mocks.readToken }));
vi.mock("@/lib/broadcast-session", () => ({
  readBroadcastSession: mocks.read,
  startGameBroadcast: mocks.start,
  stopGameBroadcast: mocks.stop,
  broadcastStartConfiguration: mocks.configured,
}));

import { GET, POST } from "./route";

function request(action?: "start" | "stop", bearer?: string) {
  return new Request(`https://example.test/api/games/${gameId}/broadcast`, {
    method: action ? "POST" : "GET",
    headers: {
      ...(action ? { "content-type": "application/json" } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(action ? { body: JSON.stringify({ action }) } : {}),
  });
}

describe("broadcast control route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verified.mockResolvedValue({ ok: true, value: account });
    mocks.readToken.mockRejectedValue(new Error("invalid token"));
    mocks.read.mockResolvedValue({ desiredState: "stopped", status: "idle" });
    mocks.start.mockResolvedValue({
      desiredState: "live",
      status: "preparing",
    });
    mocks.stop.mockResolvedValue({
      desiredState: "stopped",
      status: "stopped",
    });
    mocks.configured.mockReturnValue(true);
  });

  it("uses the explicit verified-account authority for Start", async () => {
    const response = await POST(request("start"), {
      params: Promise.resolve({ id: gameId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(gameId, account);
  });

  it("rejects an unconfigured or preview origin before claiming shared state", async () => {
    mocks.configured.mockReturnValue(false);
    const response = await POST(request("start"), {
      params: Promise.resolve({ id: gameId }),
    });
    expect(response.status).toBe(503);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("accepts only a cryptographically verified same-game organizer bearer", async () => {
    mocks.readToken.mockResolvedValue({ purpose: "organizer", gameId });
    await POST(request("stop", "organizer-token"), {
      params: Promise.resolve({ id: gameId }),
    });
    expect(mocks.stop).toHaveBeenCalledWith(gameId, {
      kind: "organizer",
      token: "organizer-token",
    });
    expect(mocks.verified).not.toHaveBeenCalled();
  });

  it.each([
    ["unverified account", undefined, { ok: false, kind: "authorization" }],
    [
      "scorer bearer",
      { purpose: "participant", gameId, role: "scorer" },
      { ok: false, kind: "authorization" },
    ],
    [
      "cross-game organizer",
      { purpose: "organizer", gameId: otherGameId },
      { ok: false, kind: "authorization" },
    ],
  ])("rejects %s", async (_label, token, verified) => {
    if (token) mocks.readToken.mockResolvedValue(token);
    mocks.verified.mockResolvedValue(verified);
    const response = await GET(
      request(undefined, token ? "bearer" : undefined),
      {
        params: Promise.resolve({ id: gameId }),
      },
    );
    expect(response.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("does not expose durable provider identifiers or credentials", async () => {
    mocks.read.mockResolvedValue({
      desiredState: "live",
      status: "live",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghi",
    });
    const response = await GET(request(), {
      params: Promise.resolve({ id: gameId }),
    });
    const value = await response.json();
    expect(value).toEqual({
      desiredState: "live",
      status: "live",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghi",
    });
    expect(JSON.stringify(value)).not.toMatch(
      /token|streamId|egressId|credentials/i,
    );
  });
});
