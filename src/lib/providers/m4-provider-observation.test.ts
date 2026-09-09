import { describe, expect, it, vi } from "vitest";
import { observeM4YouTubeProvider } from "./m4-provider-observation";

const token = "access-token";
const expected = {
  channelId: "channel",
  streamId: "stream",
  broadcastId: "broadcast",
};
function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}
function fetcher(values: unknown[]) {
  return vi
    .fn()
    .mockImplementation(() => Promise.resolve(response(values.shift())));
}
function providerValues(overrides: Record<string, unknown> = {}) {
  return [
    { items: [{ id: "channel" }] },
    {
      items: [
        {
          id: "stream",
          snippet: { channelId: "channel" },
          status: { streamStatus: "active", healthStatus: { status: "good" } },
        },
      ],
    },
    {
      items: [
        {
          id: "broadcast",
          snippet: { channelId: "channel" },
          status: { lifeCycleStatus: "live", privacyStatus: "unlisted" },
          contentDetails: {
            boundStreamId: "stream",
            enableAutoStart: false,
            enableAutoStop: false,
          },
          ...overrides,
        },
      ],
    },
  ];
}

describe("M4 provider observation", () => {
  it("uses only authenticated GET list calls and reports provider state", async () => {
    const read = fetcher(providerValues());
    await expect(
      observeM4YouTubeProvider(token, expected, read),
    ).resolves.toEqual({
      streamStatus: "active",
      healthStatus: "good",
      broadcastStatus: "live",
      broadcastLive: true,
    });
    expect(read).toHaveBeenCalledTimes(3);
    for (const [, init] of read.mock.calls) {
      expect(init.method).toBe("GET");
      expect(init.headers.authorization).toBe(`Bearer ${token}`);
    }
    expect(String(read.mock.calls[0][0])).toContain(
      "/channels?part=id&mine=true",
    );
    expect(String(read.mock.calls[1][0])).toContain(
      "/liveStreams?part=id,snippet,status&id=stream",
    );
    expect(String(read.mock.calls[2][0])).toContain(
      "/liveBroadcasts?part=id,snippet,status,contentDetails&id=broadcast",
    );
  });
  it.each([
    [{ items: [{ id: "other" }] }, "wrong owned channel"],
    [
      { items: [{ id: "channel" }] },
      {
        items: [
          {
            id: "stream",
            snippet: { channelId: "other" },
            status: { streamStatus: "ready" },
          },
        ],
      },
      "wrong stream channel",
    ],
  ])("rejects %s", async (...values) => {
    const supplied =
      typeof values[values.length - 1] === "string"
        ? values.slice(0, -1)
        : values;
    const read = fetcher([
      ...(supplied as unknown[]),
      ...providerValues().slice(supplied.length),
    ]);
    await expect(
      observeM4YouTubeProvider(token, expected, read),
    ).rejects.toThrow("m4_provider_observation_unavailable");
  });
  it.each<unknown[][]>([
    [[{ items: [{ id: "channel" }] }, { items: [] }, { items: [] }]],
    [
      [
        { items: [{ id: "channel" }] },
        {
          items: [
            {
              id: "stream",
              snippet: { channelId: "channel" },
              status: { streamStatus: "bogus" },
            },
          ],
        },
        { items: [] },
      ],
    ],
    [
      [
        { items: [{ id: "channel" }], nextPageToken: "private-page-token" },
        { items: [] },
        { items: [] },
      ],
    ],
    [
      [
        { items: [{ id: "channel" }] },
        {
          items: [
            {
              id: "stream",
              snippet: { channelId: "channel" },
              status: { streamStatus: "ready" },
            },
          ],
        },
        {
          items: [
            {
              id: "broadcast",
              snippet: { channelId: "channel" },
              status: { lifeCycleStatus: "ready", privacyStatus: "public" },
              contentDetails: {
                boundStreamId: "stream",
                enableAutoStart: false,
                enableAutoStop: false,
              },
            },
          ],
        },
      ],
    ],
  ])("rejects missing or malformed provider responses", async (values) => {
    await expect(
      observeM4YouTubeProvider(token, expected, fetcher(values)),
    ).rejects.toThrow();
  });
  it("normalizes raw provider failures without exposing a provider canary", async () => {
    const read = vi.fn().mockRejectedValue(new Error("provider-canary-secret"));
    await expect(
      observeM4YouTubeProvider(token, expected, read),
    ).rejects.toThrow(/^m4_provider_observation_unavailable$/);
    await expect(
      observeM4YouTubeProvider(token, expected, read),
    ).rejects.not.toThrow("provider-canary-secret");
  });
  it("rejects a missing stream even when the broadcast response exists", async () => {
    const read = fetcher([
      { items: [{ id: "channel" }] },
      { items: [] },
      providerValues()[2],
    ]);
    await expect(
      observeM4YouTubeProvider(token, expected, read),
    ).rejects.toThrow("m4_provider_observation_unavailable");
  });
});
