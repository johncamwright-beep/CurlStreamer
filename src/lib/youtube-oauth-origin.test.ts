import { afterEach, describe, expect, it, vi } from "vitest";
import {
  youtubeOAuthCallback,
  youtubeOAuthOrigin,
} from "./youtube-oauth-origin";
afterEach(() => vi.unstubAllEnvs());
describe("trusted OAuth deployment origin", () => {
  it.each([
    undefined,
    "http://localhost:3000",
    "https://example.test/path",
    "https://user:password@example.test",
  ])("fails closed for invalid production origin %s", (value) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", value);
    expect(() =>
      youtubeOAuthOrigin(new Request("http://127.0.0.1:3000")),
    ).toThrow();
  });
  it.each(["?redirect=secret", "#fragment"])(
    "rejects callback URL extras %s",
    (suffix) => {
      expect(() =>
        youtubeOAuthCallback(
          `https://example.test/api/settings/youtube/oauth/callback${suffix}`,
          "https://example.test",
        ),
      ).toThrow();
    },
  );
});
