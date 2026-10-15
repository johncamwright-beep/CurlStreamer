import { describe, expect, it } from "vitest";
import {
  googleAuthEnabled,
  googleOAuthOptions,
  isGoogleOAuthOrigin,
  isWindowsStudioBrowser,
} from "./google-auth";

describe("Google auth provider", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(googleAuthEnabled({})).toBe(false);
    expect(googleAuthEnabled({ GOOGLE_AUTH_ENABLED: "false" })).toBe(false);
    expect(googleAuthEnabled({ GOOGLE_AUTH_ENABLED: "true" })).toBe(true);
  });

  it("uses the canonical callback and minimal identity scopes", () => {
    expect(
      googleOAuthOptions("/onboarding", {
        APP_BASE_URL: "https://curlstreamer.example",
        NODE_ENV: "production",
      }),
    ).toEqual({
      redirectTo:
        "https://curlstreamer.example/auth/confirm?next=%2Fonboarding",
      scopes: "openid email profile",
    });
  });

  it("requires a configured public origin when enabled", () => {
    expect(() => googleOAuthOptions("/onboarding", {})).toThrow(
      "Google OAuth requires APP_BASE_URL",
    );
  });

  it("only allows the canonical browser origin to begin PKCE", () => {
    const environment = { APP_BASE_URL: "https://www.curlstreamer.app" };
    expect(
      isGoogleOAuthOrigin("https://www.curlstreamer.app", environment),
    ).toBe(true);
    expect(
      isGoogleOAuthOrigin("https://preview.curlstreamer.app", environment),
    ).toBe(false);
  });
  it("recognizes the Windows Studio browser", () => {
    expect(isWindowsStudioBrowser("CurlStreamerStudio/0.3")).toBe(true);
    expect(isWindowsStudioBrowser("Mozilla/5.0")).toBe(false);
  });
});
