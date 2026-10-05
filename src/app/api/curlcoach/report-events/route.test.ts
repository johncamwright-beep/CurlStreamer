import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ account: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/curlcoach/access", () => ({ labEnabled: () => false }));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/providers/shot-tracker-reports", () => ({
  listReportEvents: m.list,
}));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  m.account.mockResolvedValue({ userId: "coach", organizationId: "org" });
  m.list.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
it("requires private coach access before reading the library", async () => {
  m.account.mockResolvedValue(null);
  expect((await GET()).status).toBe(403);
  expect(m.list).not.toHaveBeenCalled();
  vi.stubEnv("CURLCOACH_ENABLED", "false");
  expect((await GET()).status).toBe(404);
});
it("uses the authenticated account and prevents shared caching", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(m.list).toHaveBeenCalledWith({
    userId: "coach",
    organizationId: "org",
  });
});
it("does not expose storage errors", async () => {
  m.list.mockRejectedValue(new Error("private database details"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("database");
});
