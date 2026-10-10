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
  it("reads optional live viewers only after ownership checks and caches the count", async () => {
    const values = providerValues();
    values.push({
      items: [
        { id: "broadcast", liveStreamingDetails: { concurrentViewers: "27" } },
      ],
    } as never);
    const read = fetcher(values);
    await expect(
      observeM4YouTubeProvider(token, expected, read, true),
    ).resolves.toMatchObject({ concurrentViewers: 27 });
    expect(read).toHaveBeenCalledTimes(4);
    const cached = fetcher(providerValues());
    await expect(
      observeM4YouTubeProvider(token, expected, cached, true),
    ).resolves.toMatchObject({ concurrentViewers: 27 });
    expect(cached).toHaveBeenCalledTimes(3);
  });
  it("accepts Public only when Public is expected", async () => {
    const values = () =>
      providerValues({
        status: { lifeCycleStatus: "live", privacyStatus: "public" },
      });
    await expect(
      observeM4YouTubeProvider(
        token,
        { ...expected, visibility: "public" },
        fetcher(values()),
      ),
    ).resolves.toMatchObject({ broadcastLive: true });
    await expect(
      observeM4YouTubeProvider(token, expected, fetcher(values())),
    ).rejects.toThrow();
    await expect(
      observeM4YouTubeProvider(
        token,
        { ...expected, visibility: "public" },
        fetcher(providerValues()),
      ),
    ).rejects.toThrow();
  });
  it("checks ownership first, then reads stream and broadcast concurrently", async () => {
    const values = providerValues();
    const pending: ((response: Response) => void)[] = [];
    const read = vi
      .fn<typeof fetch>()
      .mockImplementation(
        () => new Promise<Response>((resolve) => pending.push(resolve)),
      );
    const result = observeM4YouTubeProvider(token, expected, read);
    expect(read).toHaveBeenCalledTimes(1);
    pending[0](response(values[0]));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    // Neither resource response has arrived yet; both reads are already running.
    pending[1](response(values[1]));
    pending[2](response(values[2]));
    await expect(result).resolves.toMatchObject({ broadcastLive: true });
  });
  it("does not read resource data after a wrong owned channel", async () => {
    const read = fetcher([{ items: [{ id: "other" }] }]);
    await expect(
      observeM4YouTubeProvider(token, expected, read),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
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
