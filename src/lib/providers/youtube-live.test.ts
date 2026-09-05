import { describe, expect, it, vi } from "vitest";
import {
  findOrCreateYouTubeBroadcast,
  findOrCreateYouTubeStream,
  finishYouTubeBroadcast,
} from "./youtube-live";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("YouTube Live provider", () => {
  it("creates a broadcast with the exact configured title and visibility", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(
        json({
          id: "broadcast-id",
          snippet: { description: "CurlCast broadcast session session-key" },
          status: { lifeCycleStatus: "ready" },
        }),
      );
    const value = await findOrCreateYouTubeBroadcast(
      {
        accessToken: "access-token",
        sessionKey: "session-key",
        title: "Club Final — Sheet 4",
        visibility: "unlisted",
      },
      fetcher,
    );
    const init = fetcher.mock.calls[1][1]!;
    const body = JSON.parse(String(init.body));
    expect(body.snippet.title).toBe("Club Final — Sheet 4");
    expect(body.status.privacyStatus).toBe("unlisted");
    expect(body.contentDetails.recordFromStart).toBe(true);
    expect(body.contentDetails.enableAutoStart).toBe(true);
    expect(body.contentDetails.enableAutoStop).toBe(true);
    expect(value.watchUrl).toBe("https://www.youtube.com/watch?v=broadcast-id");
  });

  it("searches every broadcast page and uses only one required list filter", async () => {
    const description =
      "CurlCast broadcast session 11111111-1111-4111-8111-111111111111";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          items: [],
          nextPageToken: "next page",
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: "on-page-two",
              snippet: { description },
              status: { lifeCycleStatus: "ready" },
            },
          ],
        }),
      );
    const value = await findOrCreateYouTubeBroadcast(
      {
        accessToken: "token",
        sessionKey: "11111111-1111-4111-8111-111111111111",
        title: "Final",
        visibility: "unlisted",
      },
      fetcher,
      false,
    );
    expect(value.id).toBe("on-page-two");
    expect(fetcher.mock.calls[0][0]).toContain("broadcastStatus=all");
    expect(fetcher.mock.calls[0][0]).not.toContain("mine=true");
    expect(fetcher.mock.calls[1][0]).toContain("pageToken=next%20page");
  });

  it("returns fixed guidance when YouTube Live is not enabled", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          error: {
            errors: [{ reason: "liveStreamingNotEnabled" }],
          },
        },
        403,
      ),
    );
    await expect(
      findOrCreateYouTubeBroadcast(
        {
          accessToken: "token",
          sessionKey: "session",
          title: "Final",
          visibility: "private",
        },
        fetcher,
      ),
    ).rejects.toThrow("youtube_live_streaming_not_enabled");
  });

  it("recovers a timeout retry by its durable marker without creating a duplicate", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        items: [
          {
            id: "existing",
            snippet: {
              description:
                "CurlCast broadcast session 11111111-1111-4111-8111-111111111111",
            },
            status: { lifeCycleStatus: "ready" },
          },
        ],
      }),
    );
    const value = await findOrCreateYouTubeBroadcast(
      {
        accessToken: "token",
        sessionKey: "11111111-1111-4111-8111-111111111111",
        title: "Same title",
        visibility: "private",
      },
      fetcher,
    );
    expect(value.id).toBe("existing");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not create when a prior create intent remains unresolved", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ items: [] }));
    await expect(
      findOrCreateYouTubeBroadcast(
        {
          accessToken: "token",
          sessionKey: "unresolved-session",
          title: "Final",
          visibility: "unlisted",
        },
        fetcher,
        false,
      ),
    ).rejects.toThrow("broadcast_operation_uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });

  it("keeps the stream key server-side while returning one RTMP target", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(
        json({
          id: "stream-id",
          snippet: { description: "CurlCast broadcast session session-key" },
          cdn: {
            ingestionInfo: {
              ingestionAddress: "rtmp://a.rtmp.youtube.com/live2",
              streamName: "secret-stream-key",
            },
          },
          status: { streamStatus: "ready" },
        }),
      );
    const value = await findOrCreateYouTubeStream(
      { accessToken: "token", sessionKey: "session-key", title: "Final" },
      fetcher,
    );
    expect(value.rtmpUrl).toBe(
      "rtmp://a.rtmp.youtube.com/live2/secret-stream-key",
    );
  });

  it("deletes an interrupted upcoming broadcast instead of claiming a replay", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: "broadcast-id",
              snippet: { description: "marker" },
              status: { lifeCycleStatus: "ready" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await finishYouTubeBroadcast("token", "broadcast-id", fetcher);
    expect(fetcher.mock.calls[1][1]?.method).toBe("DELETE");
  });

  it("preserves transitional video and retries Stop instead of deleting it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        items: [
          {
            id: "broadcast-id",
            snippet: { description: "marker" },
            status: { lifeCycleStatus: "liveStarting" },
          },
        ],
      }),
    );
    await expect(
      finishYouTubeBroadcast("token", "broadcast-id", fetcher),
    ).rejects.toThrow("youtube_broadcast_stop_pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts an auto-stop race only after re-reading complete evidence", async () => {
    const item = (lifeCycleStatus: string) => ({
      items: [
        {
          id: "broadcast-id",
          snippet: { description: "marker" },
          status: { lifeCycleStatus },
        },
      ],
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(item("live")))
      .mockResolvedValueOnce(json({ error: { errors: [] } }, 400))
      .mockResolvedValueOnce(json(item("complete")));
    await expect(
      finishYouTubeBroadcast("token", "broadcast-id", fetcher),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
