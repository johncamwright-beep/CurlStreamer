import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/providers/m4-desktop-authority", () => ({
  m4DesktopEnabled: mocks.enabled,
}));

import { POST } from "./route";

const gameId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const pauseId = "44444444-4444-4444-8444-444444444444";
const bearer = "b".repeat(43);
const desktopHeaders = { authorization: `Bearer ${bearer}` };
const stoppedAt = "2026-11-11T14:00:00.000Z";
const resumedAt = "2026-11-11T14:05:00.000Z";
const body = { sessionId, generation: 2, intentId, pauseId, stoppedAt };
const context = { params: Promise.resolve({ id: gameId }) };

function request(value: unknown = body, headers: HeadersInit = desktopHeaders) {
  return new Request("https://pilot.example/output-pause", {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.rpc.mockResolvedValue({ error: null });
});

it.each([undefined, resumedAt])(
  "records a pause bound to the delivered output with resumedAt %s",
  async (resume) => {
    const response = await POST(
      request({ ...body, resumedAt: resume }),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ recorded: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "record_m4_output_pause",
      {
        p_game_id: gameId,
        p_session_id: sessionId,
        p_generation: 2,
        p_bearer_hash: createHash("sha256").update(bearer).digest("hex"),
        p_intent_id: intentId,
        p_pause_id: pauseId,
        p_stopped_at: stoppedAt,
        p_resumed_at: resume ?? null,
      },
    );
  },
);

it.each<HeadersInit>([
  { cookie: "account=valid" },
  { authorization: "Bearer participant" },
  { ...desktopHeaders, origin: "https://pilot.example" },
  { ...desktopHeaders, "sec-fetch-site": "none" },
])("rejects requests outside desktop authority", async (headers) => {
  expect((await POST(request(body, headers), context)).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each([
  { ...body, generation: 0 },
  { ...body, pauseId: "bad" },
  { ...body, stoppedAt: "2026-11-11T14:00:00" },
  { ...body, resumedAt: stoppedAt },
  { ...body, resumedAt: "2026-11-11T13:59:59Z" },
  { ...body, youtubeBroadcastId: "video" },
])("rejects malformed interval evidence", async (value) => {
  expect((await POST(request(value), context)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each([
  ["22023", 400],
  ["42501", 403],
  ["55000", 409],
  ["other", 503],
])("returns a safe error for RPC code %s", async (code, status) => {
  mocks.rpc.mockResolvedValue({ error: { code, message: "private-canary" } });
  const response = await POST(request(), context);
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain("private-canary");
});
