import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  defaultPreferences,
  emptySupplement,
} from "@/lib/curlcoach/enhanced-catalog";
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  state: vi.fn(),
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: mocks.account,
}));
vi.mock("@/lib/providers/curlcoach-store", () => ({
  loadCoachState: mocks.state,
}));
vi.mock("@/lib/providers/shot-tracker-enhanced", async (original) => ({
  ...(await original<typeof import("@/lib/providers/shot-tracker-enhanced")>()),
  loadEnhanced: mocks.read,
  saveEnhanced: mocks.save,
}));
import { GET, POST } from "./route";
const account = { userId: randomUUID(), organizationId: randomUUID() };
const request = (data: unknown, origin = "https://curlstreamer.app") =>
  new Request("https://curlstreamer.app/api/curlcoach/enhanced", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(data),
  });
const write = () => ({
  kind: "preferences",
  requestId: randomUUID(),
  expectedRevision: 0,
  sourceRevision: 0,
  value: defaultPreferences,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  vi.stubEnv("CURLCOACH_LOCAL_LAB", "false");
  mocks.account.mockResolvedValue(account);
  mocks.read.mockResolvedValue([]);
  mocks.save.mockResolvedValue({ revision: 1, value: defaultPreferences });
});
afterEach(() => vi.unstubAllEnvs());
it("requires private coach access before reading or saving", async () => {
  mocks.account.mockResolvedValue(null);
  expect(
    (await GET(new Request("https://curlstreamer.app/api/curlcoach/enhanced")))
      .status,
  ).toBe(403);
  expect((await POST(request({ write: write() }))).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects cross-origin writes and client-supplied identities", async () => {
  expect(
    (await POST(request({ write: write() }, "https://elsewhere.example")))
      .status,
  ).toBe(403);
  expect(
    (await POST(request({ actorUserId: randomUUID(), write: write() }))).status,
  ).toBe(400);
  expect(
    (
      await GET(
        new Request(
          `https://curlstreamer.app/api/curlcoach/enhanced?actorUserId=${randomUUID()}`,
        ),
      )
    ).status,
  ).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("derives organization and actor from the authenticated account, with private cache headers", async () => {
  const response = await POST(request({ write: write() }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.save.mock.calls[0][0]).toEqual({
    organizationId: account.organizationId,
    actorUserId: account.userId,
    gameId: undefined,
  });
});
it("fails closed on foreign game state and rejects contradictory observations before storage", async () => {
  const gameId = randomUUID();
  mocks.state.mockRejectedValueOnce(new Error("Game unavailable"));
  expect(
    (
      await GET(
        new Request(
          `https://curlstreamer.app/api/curlcoach/enhanced?gameId=${gameId}`,
        ),
      )
    ).status,
  ).toBe(503);
  expect(mocks.read).not.toHaveBeenCalled();
  const value = emptySupplement();
  value.assessments.misses = "assessed";
  value.values.misses = ["flash_wide", "wreck_on_guard"];
  value.values.primaryMiss = "flash_wide";
  const response = await POST(
    request({
      gameId,
      write: { ...write(), kind: "supplement", shotId: randomUUID(), value },
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
