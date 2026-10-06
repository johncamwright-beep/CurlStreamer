import { describe, expect, it, vi } from "vitest";
import {
  findOrCreateYouTubeBroadcast,
  findOrCreateYouTubeStream,
  finishYouTubeBroadcast,
  updateScheduledYouTubeTime,
} from "./youtube-live";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("YouTube Live provider", () => {
  it("updates the existing upcoming broadcast start without creating a new video", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: "video",
              status: { lifeCycleStatus: "ready", privacyStatus: "public" },
              snippet: { description: "CurlCast broadcast session game" },
              contentDetails: { enableAutoStart: false, enableAutoStop: false },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          id: "video",
          snippet: { description: "CurlCast broadcast session game" },
        }),
      );
    await updateScheduledYouTubeTime(
      "token",
      "video",
      "game",
      "Game — 8:00 AM EDT",
      "2026-09-17T12:00:00.000Z",
      "public",
      fetcher,
    );
    const init = fetcher.mock.calls[1][1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({
      id: "video",
      snippet: {
        scheduledStartTime: "2026-09-17T12:00:00.000Z",
        title: "Game — 8:00 AM EDT",
      },
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("status");
    expect(fetcher.mock.calls[1][0]).toContain("part=snippet");
    expect(fetcher.mock.calls[1][0]).not.toContain("status");
  });
  it("does not reschedule a live broadcast", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        items: [
          {
            id: "video",
            status: { lifeCycleStatus: "live", privacyStatus: "unlisted" },
            snippet: { description: "CurlCast broadcast session game" },
            contentDetails: { enableAutoStart: false, enableAutoStop: false },
          },
        ],
      }),
    );
    await expect(
      updateScheduledYouTubeTime(
        "token",
        "video",
        "game",
        "Game",
        "2026-09-17T12:00:00Z",
        "unlisted",
        fetcher,
      ),
    ).rejects.toThrow("already_started");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: "other" },
    { snippet: { description: "wrong marker", channelId: "channel" } },
    {
      snippet: {
        description: "CurlCast broadcast session game",
        channelId: "other",
      },
    },
    { contentDetails: { enableAutoStart: true, enableAutoStop: false } },
  ])(
    "rejects reserved-page identity or lifecycle mismatches before updating: %j",
    async (override) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        json({
          items: [
            {
              id: "video",
              snippet: {
                description: "CurlCast broadcast session game",
                channelId: "channel",
              },
              status: { lifeCycleStatus: "ready", privacyStatus: "unlisted" },
              contentDetails: {
                enableAutoStart: false,
                enableAutoStop: false,
              },
              ...override,
            },
          ],
        }),
      );
      await expect(
        updateScheduledYouTubeTime(
          "token",
          "video",
          "game",
          "Final",
          "2026-11-01T06:30:00Z",
          "unlisted",
          fetcher,
          "channel",
        ),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects a reserved-page privacy mismatch before any update", async () => {
    const item = {
      id: "video",
      snippet: { description: "CurlCast broadcast session game" },
      status: { lifeCycleStatus: "ready", privacyStatus: "unlisted" },
      contentDetails: { enableAutoStart: false, enableAutoStop: false },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [item] }))
      .mockResolvedValueOnce(json(item));
    await expect(
      updateScheduledYouTubeTime(
        "token",
        "video",
        "game",
        "Final",
        "2026-11-01T06:30:00Z",
        "public",
        fetcher,
      ),
    ).rejects.toThrow("youtube_manual_configuration_mismatch");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  const manualValues = {
    accessToken: "token",
    sessionKey: "manual-session",
    title: "Rehearsal",
    visibility: "unlisted" as const,
    manualLifecycle: true,
  };
  const manualBroadcast = {
    id: "manual-id",
    snippet: { description: "CurlCast broadcast session manual-session" },
    status: { lifeCycleStatus: "ready", privacyStatus: "unlisted" },
    contentDetails: { enableAutoStart: false, enableAutoStop: false },
  };
  it("creates an unlisted manual-lifecycle broadcast without transitioning live", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json(manualBroadcast));
    await findOrCreateYouTubeBroadcast(manualValues, fetcher);
    expect(fetcher.mock.calls[0][0]).toContain(
      "part=id,snippet,status,contentDetails",
    );
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body).toMatchObject({
      status: { privacyStatus: "unlisted" },
      contentDetails: { enableAutoStart: false, enableAutoStop: false },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/transition")),
    ).toBe(false);
  });
  it("marks provider insertion only after broadcast discovery succeeds", async () => {
    const beforeInsert = vi.fn();
    const failedDiscovery = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    await expect(
      findOrCreateYouTubeBroadcast(
        manualValues,
        failedDiscovery,
        true,
        beforeInsert,
      ),
    ).rejects.toThrow("youtube_provider_unavailable");
    expect(beforeInsert).not.toHaveBeenCalled();

    const failedInsert = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(
      findOrCreateYouTubeBroadcast(
        manualValues,
        failedInsert,
        true,
        beforeInsert,
      ),
    ).rejects.toThrow("youtube_provider_unavailable");
    expect(beforeInsert).toHaveBeenCalledOnce();
  });
  it("uses the scheduled game instant for a reserved watch page", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json(manualBroadcast));
    await findOrCreateYouTubeBroadcast(
      {
        ...manualValues,
        scheduledStartTime: "2026-11-01T06:30:00.000Z",
      },
      fetcher,
    );
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.snippet.scheduledStartTime).toBe("2026-11-01T06:30:00.000Z");
  });
  it("reuses verified manual configuration without duplicate creation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ items: [manualBroadcast] }));
    await expect(
      findOrCreateYouTubeBroadcast(manualValues, fetcher, false),
    ).resolves.toMatchObject({ id: "manual-id" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });
  it.each([
    { status: { lifeCycleStatus: "ready" } },
    { status: { lifeCycleStatus: "ready", privacyStatus: "public" } },
    { status: { lifeCycleStatus: "ready", privacyStatus: "private" } },
    { contentDetails: undefined },
    { contentDetails: { enableAutoStart: true, enableAutoStop: false } },
    { contentDetails: { enableAutoStart: false, enableAutoStop: true } },
    { contentDetails: { enableAutoStart: "false", enableAutoStop: false } },
  ])(
    "rejects missing or mismatched manual discovery instead of creating a duplicate: %j",
    async (override) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ items: [{ ...manualBroadcast, ...override }] }),
        );
      await expect(
        findOrCreateYouTubeBroadcast(manualValues, fetcher),
      ).rejects.toThrow("youtube_manual_configuration_mismatch");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    },
  );
  it.each(["public", "private"] as const)(
    "creates and reuses exact manual %s visibility without transitioning",
    async (visibility) => {
      const broadcast = {
        ...manualBroadcast,
        status: { lifeCycleStatus: "ready", privacyStatus: visibility },
      };
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ items: [] }))
        .mockResolvedValueOnce(json(broadcast))
        .mockResolvedValueOnce(json({ items: [broadcast] }));
      await expect(
        findOrCreateYouTubeBroadcast({ ...manualValues, visibility }, fetcher),
      ).resolves.toMatchObject({ id: "manual-id" });
      await expect(
        findOrCreateYouTubeBroadcast(
          { ...manualValues, visibility },
          fetcher,
          false,
        ),
      ).resolves.toMatchObject({ id: "manual-id" });
      expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
        status: { privacyStatus: visibility },
        contentDetails: { enableAutoStart: false, enableAutoStop: false },
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );
  it("creates a broadcast with the exact configured title and visibility", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(
        json({
          id: "broadcast-id",
          snippet: { description: "CurlCast broadcast session session-key" },
          status: { lifeCycleStatus: "ready", privacyStatus: "unlisted" },
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
              status: { lifeCycleStatus: "ready", privacyStatus: "unlisted" },
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
            status: { lifeCycleStatus: "ready", privacyStatus: "private" },
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
