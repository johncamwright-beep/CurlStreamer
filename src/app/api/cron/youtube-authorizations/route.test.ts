import { afterEach, beforeEach, expect, it, vi } from "vitest";
const worker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/providers/youtube-authorization-maintenance", () => ({
  maintainYouTubeAuthorizations: worker,
}));
import { GET } from "./route";
const secret = "fixture-secret-for-cron-authorization-32";
const summary = {
  processed: 0,
  verified: 0,
  removed: 0,
  removedUnconfirmed: 0,
  retry: 0,
  stale: 0,
  failed: 0,
};
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  worker.mockReset().mockResolvedValue(summary);
});
afterEach(() => vi.unstubAllEnvs());
function request(auth = `Bearer ${secret}`, query = "") {
  return new Request(
    `https://curlstreamer.example/api/cron/youtube-authorizations${query}`,
    { headers: { authorization: auth } },
  );
}
it("requires a configured strong server secret", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(request())).status).toBe(503);
  expect(worker).not.toHaveBeenCalled();
});
it("rejects missing or incorrect authorization before privileged work", async () => {
  expect((await GET(request(""))).status).toBe(401);
  expect((await GET(request("Bearer wrong"))).status).toBe(401);
  expect(worker).not.toHaveBeenCalled();
});
it("validates route input with Zod", async () => {
  expect((await GET(request(undefined, "?organization=override"))).status).toBe(
    400,
  );
  expect(worker).not.toHaveBeenCalled();
});
it("returns safe aggregate results to the authorized scheduler", async () => {
  const r = await GET(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual(summary);
});
it("exposes pending retry as an actionable scheduler failure", async () => {
  worker.mockResolvedValue({ ...summary, retry: 1 });
  expect((await GET(request())).status).toBe(503);
});
it("sanitizes unexpected errors", async () => {
  worker.mockRejectedValue(new Error("fixture-token"));
  const r = await GET(request());
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("fixture-token");
});
