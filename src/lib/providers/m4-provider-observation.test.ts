import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeM4YouTubeProvider } from "./m4-provider-observation";

const token = "access-token";
const expected = {
  channelId: "channel",
  streamId: "stream",
  broadcastId: "broadcast",
};
function ownershipScope(name: string) {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    connectionVersion: 1,
    credentialDigest: createHash("sha256").update(name).digest("hex"),
  };
}
afterEach(() => vi.useRealTimers());
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
  it("reuses only verified channel identity for five minutes without renewing its age on a hit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    const scope = ownershipScope("ttl");
    const first = fetcher(providerValues());
    await observeM4YouTubeProvider(token, expected, first, false, scope);
    expect(first).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(299999);
    const cached = fetcher(providerValues().slice(1));
    await observeM4YouTubeProvider(token, expected, cached, false, scope);
    expect(cached).toHaveBeenCalledTimes(2);
    expect(String(cached.mock.calls[0][0])).toContain("/liveStreams?");

    vi.advanceTimersByTime(1);
    const expired = fetcher(providerValues());
    await observeM4YouTubeProvider(token, expected, expired, false, scope);
    expect(expired).toHaveBeenCalledTimes(3);
    expect(String(expired.mock.calls[0][0])).toContain("/channels?");
  });
  it.each([
    [
      "organization",
      { organizationId: "22222222-2222-4222-8222-222222222222" },
    ],
    ["connection version", { connectionVersion: 2 }],
    ["credentials", { credentialDigest: "b".repeat(64) }],
  ])(
    "isolates verified identity after a change to %s",
    async (name, change) => {
      const scope = ownershipScope("scope-" + name);
      await observeM4YouTubeProvider(
        token,
        expected,
        fetcher(providerValues()),
        false,
        scope,
      );
      const changed = fetcher(providerValues());
      await observeM4YouTubeProvider(token, expected, changed, false, {
        ...scope,
        ...change,
      });
      expect(changed).toHaveBeenCalledTimes(3);
      expect(String(changed.mock.calls[0][0])).toContain("/channels?");
    },
  );
  it("isolates verified identity by expected channel", async () => {
    const scope = ownershipScope("channel");
    await observeM4YouTubeProvider(
      token,
      expected,
      fetcher(providerValues()),
      false,
      scope,
    );
    const changed = fetcher([{ items: [{ id: "channel" }] }]);
    await expect(
      observeM4YouTubeProvider(
        token,
        { ...expected, channelId: "other" },
        changed,
        false,
        scope,
      ),
    ).rejects.toThrow();
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("coalesces concurrent identity checks while independently verifying both resource pairs", async () => {
    const scope = ownershipScope("coalesced");
    let finish!: (value: Response) => void;
    const read = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes("/channels?"))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return response(providerValues()[path.includes("/liveStreams?") ? 1 : 2]);
    });
    const first = observeM4YouTubeProvider(token, expected, read, false, scope);
    const second = observeM4YouTubeProvider(
      token,
      expected,
      read,
      false,
      scope,
    );
    expect(read).toHaveBeenCalledTimes(1);
    finish(response(providerValues()[0]));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(5);
  });
  it("does not cache an unavailable or wrong channel response", async () => {
    for (const failure of [
      new Response(null, { status: 503 }),
      response({ items: [{ id: "other" }] }),
    ]) {
      const scope = ownershipScope("failed-" + failure.status);
      const failed = vi.fn<typeof fetch>().mockResolvedValue(failure);
      await expect(
        observeM4YouTubeProvider(token, expected, failed, false, scope),
      ).rejects.toThrow();
      const retry = fetcher(providerValues());
      await expect(
        observeM4YouTubeProvider(token, expected, retry, false, scope),
      ).resolves.toMatchObject({ broadcastLive: true });
      expect(retry).toHaveBeenCalledTimes(3);
    }
  });
  it("still rejects changed resource ownership and binding on a channel cache hit", async () => {
    const scope = ownershipScope("resources");
    await observeM4YouTubeProvider(
      token,
      expected,
      fetcher(providerValues()),
      false,
      scope,
    );
    const mismatch = providerValues({
      contentDetails: {
        boundStreamId: "other",
        enableAutoStart: false,
        enableAutoStop: false,
      },
    });
    const changed = fetcher(mismatch.slice(1));
    await expect(
      observeM4YouTubeProvider(token, expected, changed, false, scope),
    ).rejects.toThrow();
    expect(changed).toHaveBeenCalledTimes(2);
    const wrongOwner = providerValues().slice(1);
    (
      wrongOwner[0] as { items: { snippet: { channelId: string } }[] }
    ).items[0].snippet.channelId = "other";
    await expect(
      observeM4YouTubeProvider(
        token,
        expected,
        fetcher(wrongOwner),
        false,
        scope,
      ),
    ).rejects.toThrow();
  });
  it("bounds retained identity entries", async () => {
    const firstScope = ownershipScope("bounded-first");
    await observeM4YouTubeProvider(
      token,
      expected,
      fetcher(providerValues()),
      false,
      firstScope,
    );
    for (let index = 0; index < 128; index++)
      await observeM4YouTubeProvider(
        token,
        expected,
        fetcher(providerValues()),
        false,
        ownershipScope("bounded-" + index),
      );
    const evicted = fetcher(providerValues());
    await observeM4YouTubeProvider(token, expected, evicted, false, firstScope);
    expect(evicted).toHaveBeenCalledTimes(3);
  });
  it.each([0, 1, 2])(
    "preserves a safe quota category from request %s without provider details",
    async (failed) => {
      const values = providerValues();
      let index = 0;
      const read = vi.fn(async () =>
        index++ === failed
          ? new Response(
              JSON.stringify({
                error: {
                  errors: [
                    { reason: "quotaExceeded", message: "secret-canary" },
                  ],
                },
              }),
              { status: 403 },
            )
          : response(values[index - 1]),
      );
      const error = await observeM4YouTubeProvider(token, expected, read).catch(
        (error) => error,
      );
      expect(error).toMatchObject({
        message: "m4_provider_observation_unavailable",
        reason: "youtube_quota_exceeded",
      });
      expect(JSON.stringify(error)).not.toContain("secret-canary");
    },
  );
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
