import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "11111111-1111-4111-8111-111111111111" };
const configuration = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://example.test/api/settings/youtube/oauth/callback",
};
const mocks = vi.hoisted(() => ({
  manager: vi.fn(),
  configuration: vi.fn(),
  pkce: vi.fn(),
  authorizationUrl: vi.fn(),
  begin: vi.fn(),
  seal: vi.fn(),
}));
vi.mock("@/lib/youtube-route-auth", () => ({
  requireYouTubeManager: mocks.manager,
}));
vi.mock("@/lib/youtube-connection", () => ({ beginYouTubeOAuth: mocks.begin }));
vi.mock("@/lib/providers/youtube", () => ({
  youtubeConfiguration: mocks.configuration,
  createYouTubePkce: mocks.pkce,
  createYouTubeAuthorizationUrl: mocks.authorizationUrl,
}));
vi.mock("@/lib/youtube-oauth-state", () => ({
  YOUTUBE_OAUTH_COOKIE: "curlstreamer_youtube_oauth",
  sealYouTubeOAuthState: mocks.seal,
}));

import { GET } from "./route";

describe("YouTube OAuth start", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("APP_BASE_URL", undefined);
    vi.stubEnv("NODE_ENV", "test");
    mocks.manager.mockResolvedValue(user);
    mocks.configuration.mockReturnValue(configuration);
    mocks.pkce.mockReturnValue({
      verifier: "verifier",
      challenge: "challenge",
    });
    mocks.begin.mockResolvedValue({
      organization_id: "22222222-2222-4222-8222-222222222222",
      expected_version: 2,
    });
    mocks.authorizationUrl.mockReturnValue(
      new URL("https://accounts.google.com/o/oauth2/v2/auth"),
    );
    mocks.seal.mockReturnValue("sealed");
  });

  it("creates a browser-bound short-lived attempt", async () => {
    const response = await GET(
      new Request("https://example.test/api/settings/youtube/oauth/start"),
    );
    expect(response.status).toBe(307);
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.seal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        organizationId: "22222222-2222-4222-8222-222222222222",
        expectedVersion: 2,
        verifier: "verifier",
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("fails closed on preview/production callback mismatch", async () => {
    const response = await GET(
      new Request("https://preview.example/api/settings/youtube/oauth/start"),
    );
    expect(response.status).toBe(503);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("denies non-administrators", async () => {
    mocks.manager.mockResolvedValue(null);
    const response = await GET(
      new Request("https://example.test/api/settings/youtube/oauth/start"),
    );
    expect(response.status).toBe(403);
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it.each(["http", "https"])(
    "uses configured HTTPS callback behind a Next %s loopback URL",
    async (protocol) => {
      vi.stubEnv("APP_BASE_URL", "https://example.test");
      vi.stubEnv("NODE_ENV", "production");
      const response = await GET(
        new Request(
          `${protocol}://127.0.0.1:3000/api/settings/youtube/oauth/start`,
          {
            headers: {
              "x-forwarded-host": "attacker.example",
              "x-forwarded-proto": "http",
            },
          },
        ),
      );
      expect(response.status).toBe(307);
      expect(mocks.begin).toHaveBeenCalledOnce();
      expect(response.headers.get("set-cookie")).toContain("Secure");
      expect(mocks.authorizationUrl.mock.calls[0][2].redirectUri).toBe(
        configuration.redirectUri,
      );
    },
  );
  it("rejects an unrelated public host even when forwarding headers claim the canonical host", async () => {
    vi.stubEnv("APP_BASE_URL", "https://example.test");
    const response = await GET(
      new Request("https://preview.example/api/settings/youtube/oauth/start", {
        headers: { "x-forwarded-host": "example.test" },
      }),
    );
    expect(response.status).toBe(503);
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it.each([
    "configuration",
    "callback_origin",
    "oauth_begin",
    "oauth_state",
  ] as const)(
    "reports only fixed %s stage in response and log",
    async (stage) => {
      const secret =
        "provider-error https://secret.invalid/token?client_secret=private";
      if (stage === "configuration")
        mocks.configuration.mockImplementation(() => {
          throw Error(secret);
        });
      if (stage === "callback_origin")
        mocks.configuration.mockReturnValue({
          ...configuration,
          redirectUri:
            "https://secret.invalid/api/settings/youtube/oauth/callback",
        });
      if (stage === "oauth_begin")
        mocks.begin.mockRejectedValue(
          Object.assign(Error(secret), { details: secret }),
        );
      if (stage === "oauth_state")
        mocks.seal.mockImplementation(() => {
          throw Error(secret);
        });
      const response = await GET(
        new Request("https://example.test/api/settings/youtube/oauth/start"),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "YouTube connection is not configured for this environment",
        code: `youtube_oauth_start_${stage}`,
      });
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "YouTube OAuth start failed",
        { code: `youtube_oauth_start_${stage}` },
      );
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );
});
