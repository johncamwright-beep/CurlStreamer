import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/curlcoach/access", () => ({
  labEnabled: () => false,
  sameOrigin: (r: Request) => r.headers.get("origin") === "http://localhost",
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/providers/curlcoach-store", () => ({
  loadCoachState: m.load,
  saveCoachState: m.save,
}));
import { GET, POST } from "./route";
const gameId = "00000000-0000-4000-8000-000000000001",
  shotId = "00000000-0000-4000-8000-000000000002";
const body = {
  shotId,
  expectedRevision: 1,
  review: {
    version: 1,
    id: "00000000-0000-4000-8000-000000000003",
    gameId,
    audience: "team",
    notes: "Review",
    selectedAt: "2026-11-09T20:00:10Z",
    capturedAt: "2026-11-09T20:01:00Z",
    timingEstimated: true,
  },
};
const request = (origin = "http://localhost") =>
  new Request("http://localhost/api/curlcoach/local-review", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  m.account.mockResolvedValue({ organizationId: "org", userId: "actor" });
  m.load.mockResolvedValue({
    revision: 1,
    status: "open",
    events: [{ shotId, shot: { playerId: "lead", grade: 3, note: "" } }],
    roster: [{ id: "lead", name: "Lead" }],
  });
});
afterEach(() => vi.unstubAllEnvs());
it("uses server-owned identity and an authorized game read before writing", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.load).toHaveBeenCalledWith(
    { organizationId: "org", actorUserId: "actor", gameId },
    expect.anything(),
  );
  expect(m.save).toHaveBeenCalledWith(
    { organizationId: "org", actorUserId: "actor", gameId },
    expect.anything(),
    expect.objectContaining({
      shot: expect.objectContaining({
        playerId: "lead",
        grade: 3,
        flagAudience: "team",
      }),
    }),
  );
});
it("rejects cross-origin writes, unavailable accounts and game authorization failure", async () => {
  expect((await POST(request("https://other.test"))).status).toBe(403);
  expect(m.load).not.toHaveBeenCalled();
  m.account.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  m.account.mockResolvedValue({ organizationId: "org", userId: "actor" });
  m.load.mockRejectedValue(Error("private diagnostic"));
  const result = await GET(
    new Request(`http://localhost/api/curlcoach/local-review?game=${gameId}`),
  );
  expect(result.status).toBe(403);
  expect(await result.text()).not.toContain("private diagnostic");
  expect((await POST(request())).status).toBe(409);
  expect(m.save).not.toHaveBeenCalled();
});
