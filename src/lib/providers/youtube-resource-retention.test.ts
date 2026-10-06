import { expect, it, vi } from "vitest";
import { verifyRetainedYouTubeResources } from "./youtube-resource-retention";
it("checks retained IDs in bounded batches and removes absent or differently owned resources", async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `video${i}`);
  const fetcher = vi.fn().mockImplementation(async (url: string) => {
    const parsed = new URL(url);
    const current = parsed.searchParams.get("id")!.split(",");
    return new Response(
      JSON.stringify({
        items: current
          .filter((id) => id !== "video1")
          .map((id) => ({
            id,
            snippet: { channelId: id === "video2" ? "other" : "team" },
          })),
      }),
    );
  });
  const result = await verifyRetainedYouTubeResources(
    "access",
    "team",
    [
      ...ids.map((id) => ({ kind: "broadcast" as const, id })),
      { kind: "broadcast", id: "video0" },
      { kind: "stream", id: "stream1" },
    ],
    fetcher,
  );
  expect(result).toEqual({
    missingBroadcasts: ["video1", "video2"],
    missingStreams: [],
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  for (const [url, options] of fetcher.mock.calls) {
    expect(new URL(url).origin).toBe("https://www.googleapis.com");
    expect(
      new URL(url).searchParams.get("id")!.split(",").length,
    ).toBeLessThanOrEqual(50);
    expect(options.headers.authorization).toBe("Bearer access");
    expect(options.cache).toBe("no-store");
  }
});
it("does not interpret provider outages as missing resources", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 503 }));
  await expect(
    verifyRetainedYouTubeResources(
      "access",
      "team",
      [{ kind: "stream", id: "stream" }],
      fetcher,
    ),
  ).rejects.toThrow();
});
it("does not call Google for an empty cache", async () => {
  const fetcher = vi.fn();
  expect(
    await verifyRetainedYouTubeResources("access", "team", [], fetcher),
  ).toEqual({ missingBroadcasts: [], missingStreams: [] });
  expect(fetcher).not.toHaveBeenCalled();
});
