import { expect, it, vi } from "vitest";
import { revokeYouTubeRefreshToken } from "./youtube-revocation";

it("revokes through a bounded POST with the token only in the form body", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
  await revokeYouTubeRefreshToken("fixture+refresh&token", fetcher);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "https://oauth2.googleapis.com/revoke",
    expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "token=fixture%2Brefresh%26token",
      signal: expect.any(AbortSignal),
      cache: "no-store",
      redirect: "error",
    }),
  );
});

it("allows retry after Google reports that the token was already revoked", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 }),
    );
  await expect(
    revokeYouTubeRefreshToken("fixture-refresh", fetcher),
  ).resolves.toBeUndefined();
});

it.each([
  [400, '{"error":"invalid_request"}'],
  [400, "not json"],
  [401, '{"error":"invalid_token"}'],
  [429, '{"error":"invalid_token"}'],
  [500, '{"error":"invalid_token"}'],
  [204, null],
  [400, JSON.stringify({ error: "invalid_token", extra: "x".repeat(4_096) })],
])("preserves retry on non-authoritative response %s", async (status, body) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(body, { status }));
  await expect(
    revokeYouTubeRefreshToken("fixture-refresh", fetcher),
  ).rejects.toThrow("youtube_revocation_failed");
});

it("never exposes provider exceptions containing credentials", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("secret-refresh-token"));
  await expect(
    revokeYouTubeRefreshToken("fixture-refresh", fetcher),
  ).rejects.toThrow(/^youtube_revocation_failed$/);
});

it("rejects invalid token input before contacting Google", async () => {
  const fetcher = vi.fn();
  await expect(revokeYouTubeRefreshToken("", fetcher)).rejects.toThrow(
    "youtube_revocation_failed",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
