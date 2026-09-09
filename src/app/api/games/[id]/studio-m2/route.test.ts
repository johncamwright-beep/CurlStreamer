import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorizeGame: vi.fn(),
  requireStudioConfiguration: vi.fn(),
  studioAction: vi.fn(),
  issueStudioTicket: vi.fn(),
  broadcastStudioSignal: vi.fn(),
}));
vi.mock("@/lib/game-authorization", () => ({
  authorizeGame: mocks.authorizeGame,
  authorizationError: (value: { reason: string }) => ({
    error: "Denied",
    status: value.reason === "closed" ? 410 : 401,
  }),
}));
vi.mock("@/lib/providers/m2-studio-session", () => ({
  ...mocks,
  StudioRejected: class extends Error {},
  StudioUnavailable: class extends Error {},
}));
import { POST } from "./route";
import { StudioRejected } from "@/lib/providers/m2-studio-session";
const id = "00000000-0000-4000-8000-000000000001",
  sessionId = "00000000-0000-4000-8000-000000000002",
  negotiationId = "00000000-0000-4000-8000-000000000003";
const ticket = {
  sessionId,
  negotiationId,
  generation: 1,
  assignmentGeneration: 2,
  expiresAt: Date.now() + 20_000,
};
function call(body: unknown, game = id) {
  return POST(
    new Request("http://test/api/games/" + game + "/studio", {
      method: "POST",
      body: JSON.stringify({ cameraRole: "camera-home", ...(body as object) }),
    }),
    { params: Promise.resolve({ id: game }) },
  );
}
describe("M2 studio route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "account",
      role: "owner",
      organizationId: id,
    });
    mocks.studioAction.mockResolvedValue(ticket);
    mocks.issueStudioTicket.mockResolvedValue({ ...ticket, token: "scoped" });
  });
  it("registers with only owner/admin or a same-game organizer boundary", async () => {
    const response = await call({ action: "register", side: "receiver" });
    expect(response.status).toBe(200);
    const [, game, options] = mocks.authorizeGame.mock.calls[0];
    expect(game).toBe(id);
    expect(options.accountRoles).toEqual(["owner", "team_admin"]);
    expect(options.tokenAllowed({ purpose: "organizer" })).toBe(true);
    expect(
      options.tokenAllowed({ purpose: "participant", role: "scorer" }),
    ).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.studioAction.mock.calls[0][2]).toEqual({ organizationId: id });
  });
  it.each(["unauthorized", "released", "closed", "deleted"])(
    "does not mutate after authorization failure %s",
    async (reason) => {
      mocks.authorizeGame.mockResolvedValue({ ok: false, reason });
      expect(
        (await call({ action: "ticket", side: "receiver", sessionId })).status,
      ).toBe(reason === "closed" ? 410 : 401);
      expect(mocks.studioAction).not.toHaveBeenCalled();
    },
  );
  it("uses Camera 1 device and generation, never cookie authority", async () => {
    expect((await call({ action: "begin", side: "camera" })).status).toBe(403);
    mocks.authorizeGame.mockResolvedValue({
      ok: true,
      via: "token",
      access: {
        purpose: "participant",
        role: "camera-home",
        deviceId: sessionId,
        assignmentGeneration: 7,
      },
    });
    expect((await call({ action: "begin", side: "camera" })).status).toBe(200);
    const options = mocks.authorizeGame.mock.calls[1][2];
    expect(options.accountRoles).toEqual([]);
    expect(
      options.tokenAllowed({ purpose: "participant", role: "camera-away" }),
    ).toBe(false);
    expect(
      options.tokenAllowed({ purpose: "invitation", role: "camera-home" }),
    ).toBe(false);
    expect(mocks.studioAction.mock.calls[0][2]).toEqual({
      deviceId: sessionId,
      assignmentGeneration: 7,
    });
  });
  it("rejects malformed and relay signaling before provider work", async () => {
    expect((await call({ action: "register", side: "camera" })).status).toBe(
      400,
    );
    expect(
      (
        await call({
          action: "signal",
          side: "receiver",
          sessionId,
          negotiationId,
          signal: {
            type: "ice",
            candidate: {
              candidate: "candidate:1 1 udp 1 192.168.8.1 44 typ relay",
              sdpMid: "0",
              sdpMLineIndex: 0,
            },
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call({ action: "ticket", side: "receiver" }, "bad")).status,
    ).toBe(400);
    expect(mocks.studioAction).not.toHaveBeenCalled();
  });
  it("fences stale generations and redacts provider errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.studioAction.mockRejectedValueOnce(new StudioRejected());
    expect(
      (await call({ action: "ticket", side: "receiver", sessionId })).status,
    ).toBe(409);
    mocks.studioAction.mockRejectedValueOnce(Error("private-provider-secret"));
    const response = await call({
      action: "ticket",
      side: "receiver",
      sessionId,
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-provider-secret");
    expect(log).toHaveBeenCalledWith("Studio camera service unavailable", {
      stage: "unexpected",
      databaseCode: undefined,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-provider-secret",
    );
    log.mockRestore();
  });
  it("checks authority again after an ephemeral broadcast", async () => {
    const response = await call({
      action: "signal",
      side: "receiver",
      sessionId,
      negotiationId,
      signal: { type: "offer", sdp: "v=0" },
    });
    expect(response.status).toBe(200);
    expect(mocks.broadcastStudioSignal).toHaveBeenCalledOnce();
    expect(mocks.studioAction).toHaveBeenCalledTimes(2);
    expect(mocks.studioAction.mock.calls[1][1].action).toBe("check");
  });
});

it("requires the requested camera slot claim and passes its role to the provider", async () => {
  mocks.studioAction.mockClear();
  mocks.authorizeGame.mockResolvedValue({
    ok: true,
    via: "token",
    access: {
      purpose: "participant",
      role: "camera-home",
      deviceId: sessionId,
      assignmentGeneration: 2,
    },
  });
  expect(
    (await call({ action: "begin", side: "camera", cameraRole: "camera-away" }))
      .status,
  ).toBe(403);
  expect(mocks.studioAction).not.toHaveBeenCalled();
  mocks.authorizeGame.mockResolvedValue({
    ok: true,
    via: "token",
    access: {
      purpose: "participant",
      role: "camera-away",
      deviceId: sessionId,
      assignmentGeneration: 2,
    },
  });
  expect(
    (await call({ action: "begin", side: "camera", cameraRole: "camera-away" }))
      .status,
  ).toBe(200);
  expect(mocks.studioAction.mock.calls[0][1].cameraRole).toBe("camera-away");
  expect(
    (await call({ action: "begin", side: "camera", cameraRole: undefined }))
      .status,
  ).toBe(400);
});
