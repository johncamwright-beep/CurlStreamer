import { describe, expect, it, vi } from "vitest";
import {
  createYouTubeAuthorizationUrl,
  loadOwnedYouTubeChannel,
  refreshYouTubeAccessToken,
  YOUTUBE_SCOPE,
} from "./youtube";

const configuration = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri:
    "https://curlstreamer.example/api/settings/youtube/oauth/callback",
};

describe("YouTube provider boundary", () => {
  it("requests offline PKCE authorization for the future broadcast scope", () => {
    const url = createYouTubeAuthorizationUrl(
      "state-value",
      "challenge-value",
      configuration,
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      configuration.redirectUri,
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("loads exactly one owned channel without silently selecting another", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ id: "channel-1", snippet: { title: "Club TV" } }],
        }),
        { status: 200 },
      ),
    );
    await expect(loadOwnedYouTubeChannel("access", fetcher)).resolves.toEqual({
      id: "channel-1",
      title: "Club TV",
    });
    const request = new URL(fetcher.mock.calls[0][0] as string);
    expect(request.searchParams.get("mine")).toBe("true");
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      authorization: "Bearer access",
    });
  });

  it("distinguishes revoked authorization from a transient Google outage", async () => {
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      }),
    );
    await expect(
      refreshYouTubeAccessToken("refresh", rejected, configuration),
    ).rejects.toThrow("youtube_reconnect_required");
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(
      refreshYouTubeAccessToken("refresh", unavailable, configuration),
    ).rejects.toThrow("youtube_provider_unavailable");
  });

  it.each([
    [429, {}],
    [
      403,
      {
        error: {
          errors: [{ reason: "quotaExceeded" }],
          status: "RESOURCE_EXHAUSTED",
        },
      },
    ],
    [403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }],
  ])("treats quota response %s as temporary", async (status, body) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
    await expect(loadOwnedYouTubeChannel("access", fetcher)).rejects.toThrow(
      "youtube_provider_unavailable",
    );
  });

  it("treats a non-quota channel authorization failure as reconnect-required", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { errors: [{ reason: "forbidden" }] } }),
          { status: 403 },
        ),
      );
    await expect(loadOwnedYouTubeChannel("access", fetcher)).rejects.toThrow(
      "youtube_reconnect_required",
    );
  });
});
