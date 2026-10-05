import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  load: vi.fn(),
  get: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/curlcoach/access", () => ({
  labEnabled: () => false,
  sameOrigin: (r: Request) => r.headers.get("origin") === "http://localhost",
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/providers/shot-tracker-reports", () => ({
  loadReportEvent: m.load,
  getEventReports: m.get,
  generateEventReports: m.generate,
  ReportError: class extends Error {
    status = 409;
  },
}));
import { GET, POST } from "./route";
const eventId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  m.account.mockResolvedValue({ userId: "coach", organizationId: "org" });
  m.load.mockResolvedValue({ id: eventId });
  m.get.mockResolvedValue({ entries: [] });
  m.generate.mockResolvedValue({ reports: [] });
});
afterEach(() => vi.unstubAllEnvs());
const post = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/curlcoach/reports", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
it("requires private account access and same origin", async () => {
  expect(
    (await POST(post({ eventId, audience: "team" }, "https://other.test")))
      .status,
  ).toBe(403);
  expect(m.generate).not.toHaveBeenCalled();
  m.account.mockResolvedValue(null);
  expect(
    (
      await GET(
        new Request(
          `http://localhost/api/curlcoach/reports?eventId=${eventId}`,
        ),
      )
    ).status,
  ).toBe(403);
  expect(m.load).not.toHaveBeenCalled();
});
it("rejects prompt, identity overrides and invalid audiences", async () => {
  for (const body of [
    { eventId, audience: "team", prompt: "name a player" },
    { eventId, audience: "team", actor: "other" },
    { eventId, audience: "public" },
  ])
    expect((await POST(post(body))).status).toBe(400);
  expect(m.generate).not.toHaveBeenCalled();
});
it("uses server-authorized event and private no-store responses", async () => {
  const r = await POST(post({ eventId, audience: "team" }));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(m.generate).toHaveBeenCalledWith(
    { userId: "coach", organizationId: "org" },
    { id: eventId },
    "team",
  );
});
it("never leaks source errors", async () => {
  m.load.mockRejectedValue(new Error("secret DB details"));
  const r = await GET(
    new Request(`http://localhost/api/curlcoach/reports?eventId=${eventId}`),
  );
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("secret");
});
