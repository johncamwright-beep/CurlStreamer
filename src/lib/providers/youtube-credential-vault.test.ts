import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptYouTubeRefreshToken,
  encryptYouTubeRefreshToken,
} from "./youtube-credential-vault";

describe("YouTube credential vault", () => {
  const key = randomBytes(32).toString("base64");
  const organizationId = "11111111-1111-4111-8111-111111111111";

  it("round-trips a refresh token with organization-bound authenticated data", () => {
    const envelope = encryptYouTubeRefreshToken(
      "refresh-token-value",
      organizationId,
      key,
    );
    expect(envelope).not.toContain("refresh-token-value");
    expect(decryptYouTubeRefreshToken(envelope, organizationId, key)).toBe(
      "refresh-token-value",
    );
  });

  it("rejects tampering, wrong organizations, and invalid key material", () => {
    const envelope = encryptYouTubeRefreshToken("refresh", organizationId, key);
    const tampered = Buffer.from(envelope, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() =>
      decryptYouTubeRefreshToken(
        tampered.toString("base64"),
        organizationId,
        key,
      ),
    ).toThrow("youtube_credentials_unavailable");
    expect(() =>
      decryptYouTubeRefreshToken(
        envelope,
        "22222222-2222-4222-8222-222222222222",
        key,
      ),
    ).toThrow("youtube_credentials_unavailable");
    expect(() =>
      encryptYouTubeRefreshToken("refresh", organizationId, "bad"),
    ).toThrow("youtube_credentials_unavailable");
  });
});
