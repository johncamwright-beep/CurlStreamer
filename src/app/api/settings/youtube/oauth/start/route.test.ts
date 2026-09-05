import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.resetAllMocks();
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
});
