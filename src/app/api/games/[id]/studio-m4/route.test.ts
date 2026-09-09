import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  verified: vi.fn(),
  token: vi.fn(),
  read: vi.fn(),
  prepare: vi.fn(),
  stop: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@/lib/game-completion", () => ({
  verifiedCompletionAccount: mocks.verified,
}));
vi.mock("@/lib/tokens", () => ({ readAccessToken: mocks.token }));
vi.mock("@/lib/providers/m4-youtube-session", () => ({
  readM4Session: mocks.read,
  prepareM4Session: mocks.prepare,
  stopM4Session: mocks.stop,
  m4Configuration: mocks.config,
}));
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const account = { kind: "account", userId: id };
function request(body?: unknown, headers: HeadersInit = {}) {
  return new Request(`http://127.0.0.1:3000/api/games/${id}/studio-m4`, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://pilot.example");
  vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "disposable");
  mocks.verified.mockResolvedValue({ ok: true, value: account });
  mocks.token.mockRejectedValue(Error("invalid"));
  mocks.config.mockReturnValue(true);
  mocks.read.mockResolvedValue({ desiredState: "stopped", status: "idle" });
  mocks.prepare.mockResolvedValue({ desiredState: "live", status: "prepared" });
  mocks.stop.mockResolvedValue({ desiredState: "stopped", status: "stopped" });
});
afterEach(() => vi.unstubAllEnvs());
describe("M4 private preparation and cleanup API", () => {
  it("uses verified account authority behind canonical HTTPS loopback proxy", async () => {
    const result = await POST(
      request(
        { action: "prepare" },
        {
          origin: "https://pilot.example",
          "x-forwarded-host": "attacker.example",
        },
      ),
      context,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      desiredState: "live",
      status: "prepared",
    });
    expect(mocks.prepare).toHaveBeenCalledWith(id, account);
  });
  it.each(["participant", "invitation"])(
    "denies %s credentials and a program cookie",
    async (purpose) => {
      mocks.verified.mockResolvedValue({ ok: false });
      mocks.token.mockResolvedValue({ purpose, gameId: id });
      expect(
        (
          await POST(
            request(
              { action: "prepare" },
              {
                authorization: "Bearer synthetic",
                cookie: "curlcast_m3_program=synthetic",
              },
            ),
            context,
          )
        ).status,
      ).toBe(403);
      expect(mocks.prepare).not.toHaveBeenCalled();
    },
  );
  it("accepts only matching organizer tokens and retains verified account fallback", async () => {
    mocks.token.mockResolvedValue({ purpose: "organizer", gameId: id });
    await POST(
      request({ action: "stop" }, { authorization: "Bearer synthetic" }),
      context,
    );
    expect(mocks.stop).toHaveBeenCalledWith(id, {
      kind: "organizer",
      token: "synthetic",
    });
    mocks.token.mockResolvedValue({
      purpose: "organizer",
      gameId: "22222222-2222-4222-8222-222222222222",
    });
    mocks.verified.mockResolvedValue({ ok: false });
    expect(
      (
        await GET(
          request(undefined, { authorization: "Bearer synthetic" }),
          context,
        )
      ).status,
    ).toBe(403);
    mocks.verified.mockResolvedValue({ ok: true, value: account });
    expect(
      (
        await GET(
          request(undefined, { authorization: "Bearer expired" }),
          context,
        )
      ).status,
    ).toBe(200);
  });
  it.each<HeadersInit>([
    { origin: "https://attacker.example" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects cross-origin mutation before provider work", async (headers) => {
    expect(
      (await POST(request({ action: "prepare" }, headers), context)).status,
    ).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("gates the disposable feature and preparation configuration while preserving stop", async () => {
    mocks.config.mockReturnValue(false);
    expect((await POST(request({ action: "prepare" }), context)).status).toBe(
      503,
    );
    expect((await POST(request({ action: "stop" }), context)).status).toBe(200);
    vi.stubEnv("CURLCAST_M4_LOCAL_YOUTUBE", "");
    expect((await GET(request(), context)).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each([
    { action: "start" },
    { action: "prepare", visibility: "public" },
    { action: "stop", gameId: id },
  ])(
    "rejects unsupported actions and authority/output overrides",
    async (body) => {
      expect((await POST(request(body), context)).status).toBe(400);
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.stop).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid IDs, malformed input, and invalid deployment origin", async () => {
    expect(
      (await GET(request(), { params: Promise.resolve({ id: "bad" }) })).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request("https://pilot.example", { method: "POST", body: "{" }),
          context,
        )
      ).status,
    ).toBe(400);
    vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3000");
    expect((await POST(request({ action: "prepare" }), context)).status).toBe(
      503,
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("allowlists safe results and discards credentials including watch URL extras", async () => {
    mocks.read.mockResolvedValue({
      desiredState: "live",
      status: "prepared",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk&key=secret#secret",
      streamKey: "secret",
      encryptedCredentials: "secret",
      nested: { token: "secret" },
      lastErrorCode: "raw secret",
    });
    const result = await GET(request(), context);
    expect(await result.json()).toEqual({
      desiredState: "live",
      status: "prepared",
      watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("vary")).toBe("Cookie, Authorization");
  });
  it.each(["42501", "55000", "unexpected"])(
    "sanitizes provider failure %s",
    async (code) => {
      mocks.prepare.mockRejectedValue(
        Object.assign(Error("rtmps://secret.invalid/key"), { code }),
      );
      const result = await POST(request({ action: "prepare" }), context);
      expect(result.status).toBe(
        code === "42501" ? 403 : code === "55000" ? 409 : 503,
      );
      expect(await result.text()).not.toContain("secret");
    },
  );
});
