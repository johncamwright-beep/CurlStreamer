import { describe, expect, it, vi } from "vitest";
import { getYouTubeIngestTarget, observeYouTubeIngest } from "./youtube-ingest";

const address = "rtmps://a.rtmps.youtube.com:443/live2";
const stream = {
  id: "stream-1",
  cdn: {
    ingestionType: "rtmp",
    ingestionInfo: {
      rtmpsIngestionAddress: address,
      streamName: "fixture-key",
    },
  },
  status: { streamStatus: "active", healthStatus: { status: "good" } },
};
function mock(value: unknown) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(value)));
}

describe("YouTube RTMPS ingest boundary", () => {
  it("reads the assigned primary TLS target and keeps the key separate", async () => {
    const fetcher = mock({ items: [stream] });
    await expect(
      getYouTubeIngestTarget("token", stream.id, fetcher),
    ).resolves.toEqual({
      serverUrl: address,
      streamKey: "fixture-key",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/youtube/v3/liveStreams?part=id,cdn&id=stream-1",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer token" },
      cache: "no-store",
    });
  });
  it("normalizes only the explicit approved endpoint's omitted TLS port", async () => {
    const value = structuredClone(stream);
    value.cdn.ingestionInfo.rtmpsIngestionAddress =
      "rtmps://a.rtmps.youtube.com/live2";
    expect(
      (
        await getYouTubeIngestTarget(
          "token",
          stream.id,
          mock({ items: [value] }),
        )
      ).serverUrl,
    ).toBe(address);
  });
  it.each([
    "rtmp://a.rtmps.youtube.com/live2",
    "https://a.rtmps.youtube.com/live2",
    "rtmps://a.rtmps.youtube.com.evil.test/live2",
    "rtmps://127.0.0.1/live2",
    "rtmps://user:password@a.rtmps.youtube.com/live2",
    "rtmps://a.rtmps.youtube.com:1935/live2",
    `${address}?backup=1`,
    `${address}#key`,
    `${address}/key`,
    `${address}/`,
    "rtmps://a.rtmps.youtube.com/foo/../live2",
    "rtmps://a.rtmps.youtube.com/%6cive2",
    ` ${address}`,
    `${address}\n`,
    "rtmps://b.rtmps.youtube.com/live2",
  ])("rejects unapproved or ambiguous destination %s", async (badAddress) => {
    const value = structuredClone(stream);
    value.cdn.ingestionInfo.rtmpsIngestionAddress = badAddress;
    await expect(
      getYouTubeIngestTarget("token", stream.id, mock({ items: [value] })),
    ).rejects.toThrow("youtube_ingest_destination_invalid");
  });
  it("never substitutes a cleartext address when RTMPS is absent", async () => {
    const value = {
      ...stream,
      cdn: {
        ingestionType: "rtmp",
        ingestionInfo: {
          ingestionAddress: "rtmp://a.rtmp.youtube.com/live2",
          streamName: "fixture-key",
        },
      },
    };
    await expect(
      getYouTubeIngestTarget("token", stream.id, mock({ items: [value] })),
    ).rejects.toThrow("youtube_ingest_destination_invalid");
  });
  it.each(["", "secret/key", "secret\nkey", "https://secret", "x".repeat(257)])(
    "rejects malformed keys without including their value",
    async (key) => {
      const value = structuredClone(stream);
      value.cdn.ingestionInfo.streamName = key;
      await expect(
        getYouTubeIngestTarget("token", stream.id, mock({ items: [value] })),
      ).rejects.toEqual(new Error("youtube_ingest_destination_invalid"));
    },
  );
  it("requires the requested stream and never silently picks another", async () => {
    await expect(
      getYouTubeIngestTarget("token", "other", mock({ items: [stream] })),
    ).rejects.toThrow("youtube_ingest_response_invalid");
    await expect(
      getYouTubeIngestTarget(
        "token",
        stream.id,
        mock({ items: [stream, stream] }),
      ),
    ).rejects.toThrow("youtube_ingest_response_invalid");
    await expect(
      getYouTubeIngestTarget("token", stream.id, mock({ items: [] })),
    ).rejects.toThrow("youtube_ingest_stream_missing");
  });
  it("rejects invalid ids before sending a provider request", async () => {
    const fetcher = mock({ items: [] });
    await expect(
      getYouTubeIngestTarget("token", "id&mine=true", fetcher),
    ).rejects.toThrow("youtube_ingest_invalid_stream_id");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["active", "created", "error", "inactive", "ready"])(
    "observes %s independently without requesting or returning CDN credentials",
    async (streamStatus) => {
      const fetcher = mock({
        items: [
          {
            ...stream,
            status: {
              streamStatus,
              healthStatus: {
                status: "noData",
                configurationIssues: [{ description: "secret-key" }],
              },
            },
          },
        ],
      });
      await expect(
        observeYouTubeIngest("token", stream.id, fetcher),
      ).resolves.toEqual({ streamStatus, healthStatus: "noData" });
      expect(fetcher.mock.calls[0][0]).toContain("part=id,status&");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("distinguishes missing streams from absent health telemetry", async () => {
    await expect(
      observeYouTubeIngest("token", stream.id, mock({ items: [] })),
    ).resolves.toEqual({ streamStatus: "missing", healthStatus: null });
    await expect(
      observeYouTubeIngest(
        "token",
        stream.id,
        mock({ items: [{ id: stream.id, status: { streamStatus: "ready" } }] }),
      ),
    ).resolves.toEqual({ streamStatus: "ready", healthStatus: null });
  });
  it("fails closed on unknown status and sanitizes transport failures", async () => {
    await expect(
      observeYouTubeIngest(
        "token",
        stream.id,
        mock({
          items: [{ id: stream.id, status: { streamStatus: "secret-key" } }],
        }),
      ),
    ).rejects.toEqual(new Error("youtube_ingest_response_invalid"));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("token secret-key"));
    await expect(
      getYouTubeIngestTarget("token", stream.id, fetcher),
    ).rejects.toEqual(new Error("youtube_provider_unavailable"));
  });
});
