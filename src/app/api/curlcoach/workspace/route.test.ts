import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { issueSession } from "@/lib/curlcoach/access";
const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  read: vi.fn((state) => state),
  write: vi.fn(),
  source: vi.fn(),
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
vi.mock("@/lib/providers/curlcoach-streamer", () => ({
  loadStreamerEvent: mocks.source,
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
    "local-event-test-key-with-at-least-32-characters",
  );
});
afterEach(() => vi.unstubAllEnvs());
it("gates the entire event before reading any sample or Streamer data", async () => {
  expect(
    (
      await GET(
        new Request("http://localhost/api/curlcoach/workspace?source=streamer"),
      )
    ).status,
  ).toBe(401);
  vi.stubEnv("CURLCOACH_ENABLED", "false");
  expect(
    (await GET(new Request("http://localhost/api/curlcoach/workspace"))).status,
  ).toBe(404);
  expect(mocks.source).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("returns all seven games, with private cache policy", async () => {
  mocks.token = await issueSession();
  const response = await GET(
    new Request(
      "http://localhost/api/curlcoach/workspace?eventId=shorty-example",
    ),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).event.games).toHaveLength(7);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects a shot mutation targeting a game outside the selected event", async () => {
  mocks.token = await issueSession();
  const response = await POST(
    new Request("http://localhost/api/curlcoach/workspace", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: JSON.stringify({
        source: "sample",
        eventId: "practice",
        gameId: "shorty-example-7",
        command: {
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          shotId: crypto.randomUUID(),
          shot: null,
        },
      }),
    }),
  );
  expect(response.status).toBe(403);
  expect(mocks.write).not.toHaveBeenCalled();
});
