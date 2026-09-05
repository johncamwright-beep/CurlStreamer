import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "11111111-1111-4111-8111-111111111111" };
const organizationId = "22222222-2222-4222-8222-222222222222";
const configuration = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://example.test/api/settings/youtube/oauth/callback",
};
const mocks = vi.hoisted(() => ({
  manager: vi.fn(),
  configuration: vi.fn(),
  open: vi.fn(),
  matches: vi.fn(),
  hash: vi.fn(),
  consume: vi.fn(),
  exchange: vi.fn(),
  channel: vi.fn(),
  encrypt: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/youtube-route-auth", () => ({
  requireYouTubeManager: mocks.manager,
}));
vi.mock("@/lib/youtube-connection", () => ({
  consumeYouTubeOAuth: mocks.consume,
  completeYouTubeConnection: mocks.complete,
}));
vi.mock("@/lib/providers/youtube", () => ({
  youtubeConfiguration: mocks.configuration,
  exchangeYouTubeCode: mocks.exchange,
  loadOwnedYouTubeChannel: mocks.channel,
}));
vi.mock("@/lib/providers/youtube-credential-vault", () => ({
  encryptYouTubeRefreshToken: mocks.encrypt,
}));
vi.mock("@/lib/youtube-oauth-state", () => ({
  YOUTUBE_OAUTH_COOKIE: "curlstreamer_youtube_oauth",
  openYouTubeOAuthState: mocks.open,
  matchesYouTubeOAuthState: mocks.matches,
  hashYouTubeOAuthState: mocks.hash,
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

function request(
  options: { state?: string; code?: string; cookie?: boolean } = {},
) {
  const url = new URL(configuration.redirectUri);
  if (options.state !== undefined) url.searchParams.set("state", options.state);
  if (options.code !== undefined) url.searchParams.set("code", options.code);
  return new NextRequest(url, {
    headers:
      options.cookie === false
        ? {}
        : { cookie: "curlstreamer_youtube_oauth=sealed" },
  });
}

describe("YouTube OAuth callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.manager.mockResolvedValue(user);
    mocks.configuration.mockReturnValue(configuration);
    mocks.open.mockReturnValue({
      state: "s".repeat(43),
      verifier: "verifier",
      userId: user.id,
      organizationId,
      expectedVersion: 4,
      expiresAt: Date.now() + 60_000,
    });
    mocks.matches.mockReturnValue(true);
    mocks.hash.mockReturnValue("hash");
    mocks.consume.mockResolvedValue({
      organization_id: organizationId,
      expected_version: 4,
    });
    mocks.exchange.mockResolvedValue({
      access_token: "access",
      refresh_token: "refresh",
    });
    mocks.channel.mockResolvedValue({ id: "channel-1", title: "Club TV" });
    mocks.encrypt.mockReturnValue("encrypted-envelope");
    mocks.complete.mockResolvedValue(undefined);
  });

  it("saves only encrypted credentials and expires the path-bound cookie", async () => {
    const response = await GET(
      request({ state: "s".repeat(43), code: "code" }),
    );
    expect(response.headers.get("location")).toContain("result=connected");
    expect(mocks.complete).toHaveBeenCalledWith(user, {
      organizationId,
      expectedVersion: 4,
      encryptedCredentials: "encrypted-envelope",
      channelId: "channel-1",
      channelTitle: "Club TV",
    });
    expect(mocks.complete.mock.calls[0][1]).not.toHaveProperty("refreshToken");
    expect(response.headers.get("set-cookie")).toContain(
      "Path=/api/settings/youtube/oauth/callback",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    [
      "missing cookie",
      request({ state: "s".repeat(43), code: "code", cookie: false }),
    ],
    ["missing state", request({ code: "code" })],
  ])(
    "rejects %s before Google exchange or persistence",
    async (_label, value) => {
      const response = await GET(value);
      expect(response.headers.get("location")).toContain("result=");
      expect(mocks.exchange).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
    },
  );

  it("rejects a replayed state after its single-use database record is gone", async () => {
    mocks.consume.mockRejectedValue(new Error("youtube_oauth_expired"));
    const response = await GET(
      request({ state: "s".repeat(43), code: "code" }),
    );
    expect(response.headers.get("location")).toContain("result=oauth_expired");
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("rejects changed organization authority before calling Google", async () => {
    mocks.consume.mockResolvedValue({
      organization_id: "33333333-3333-4333-8333-333333333333",
      expected_version: 4,
    });
    await GET(request({ state: "s".repeat(43), code: "code" }));
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("denies an unauthorized account without consuming state", async () => {
    mocks.manager.mockResolvedValue(null);
    const response = await GET(
      request({ state: "s".repeat(43), code: "code" }),
    );
    expect(response.headers.get("location")).toContain("result=forbidden");
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("fails closed when the configured callback origin differs", async () => {
    const response = await GET(
      new NextRequest(
        `https://preview.example/api/settings/youtube/oauth/callback?state=${"s".repeat(43)}&code=code`,
        { headers: { cookie: "curlstreamer_youtube_oauth=sealed" } },
      ),
    );
    expect(response.headers.get("location")).toContain(
      "result=connection_failed",
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
