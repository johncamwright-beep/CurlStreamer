import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  matchesYouTubeOAuthState,
  openYouTubeOAuthState,
  sealYouTubeOAuthState,
} from "./youtube-oauth-state";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

describe("YouTube OAuth browser state", () => {
  beforeEach(() => {
    vi.stubEnv(
      "YOUTUBE_CREDENTIAL_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
  });

  it("round-trips the browser, user, organization, version, and PKCE binding", () => {
    const payload = {
      state: "s".repeat(43),
      verifier: "v".repeat(43),
      userId,
      organizationId,
      expectedVersion: 7,
      expiresAt: Date.now() + 60_000,
    };
    expect(
      openYouTubeOAuthState(sealYouTubeOAuthState(payload), userId),
    ).toEqual(payload);
    expect(matchesYouTubeOAuthState(payload.state, payload.state)).toBe(true);
    expect(matchesYouTubeOAuthState(payload.state, `${payload.state}x`)).toBe(
      false,
    );
  });

  it("rejects a different user and an expired attempt", () => {
    const payload = {
      state: "s".repeat(43),
      verifier: "v".repeat(43),
      userId,
      organizationId,
      expectedVersion: 0,
      expiresAt: Date.now() - 1,
    };
    const sealed = sealYouTubeOAuthState(payload);
    expect(() => openYouTubeOAuthState(sealed, organizationId)).toThrow(
      "youtube_credentials_unavailable",
    );
    expect(() => openYouTubeOAuthState(sealed, userId)).toThrow(
      "youtube_oauth_expired",
    );
  });
});
