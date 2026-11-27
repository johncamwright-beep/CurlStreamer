import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { issueSession } from "@/lib/curlcoach/access";
import { emptyState } from "@/lib/curlcoach/model";
const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
  }),
}));
vi.mock("@/lib/providers/curlcoach-local", () => ({
  readCoachState: mocks.read,
  writeCoachEvent: mocks.write,
}));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = undefined;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LOCAL_LAB", "true");
  vi.stubEnv(
    "CURLCOACH_LAB_SECRET",
    "route-test-key-at-least-thirty-two-characters",
  );
});
afterEach(() => vi.unstubAllEnvs());
it("does not read or write any data when disabled or unauthenticated", async () => {
  vi.stubEnv("CURLCOACH_ENABLED", "false");
  expect((await GET()).status).toBe(404);
  expect(
    (
      await POST(
        new Request("http://localhost/api/curlcoach/game", { method: "POST" }),
      )
    ).status,
  ).toBe(404);
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  expect((await GET()).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("returns private no-store data only for the scoped session", async () => {
  mocks.token = await issueSession();
  mocks.read.mockReturnValue(emptyState());
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects cross-origin and invalid input without writing", async () => {
  mocks.token = await issueSession();
  expect(
    (
      await POST(
        new Request("http://localhost/api/curlcoach/game", {
          method: "POST",
          headers: { origin: "http://other-host" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        new Request("http://localhost/api/curlcoach/game", {
          method: "POST",
          headers: { origin: "http://localhost" },
          body: JSON.stringify({ organizationId: "another-org" }),
        }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.write).not.toHaveBeenCalled();
});
