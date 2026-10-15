import { describe, expect, it, vi } from "vitest";
import { verifyM4ProviderRetirement } from "./m4-provider-retirement";

const expected = {
  channelId: "channel-1",
  streamId: "stream-1",
  broadcastId: "broadcast-1",
};
const owned = { items: [{ id: expected.channelId }] };
const completed = {
  items: [
    { id: expected.broadcastId, status: { lifeCycleStatus: "complete" } },
  ],
};
function responses(...values: unknown[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const value of values)
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(value)));
  return fetcher;
}

describe("M4 independent provider retirement evidence", () => {
  it.each([{ items: [] }, completed])(
    "accepts deleted stream and terminal broadcast %j",
    async (broadcast) => {
      const fetcher = responses(owned, { items: [] }, broadcast);
      await expect(
        verifyM4ProviderRetirement("private-token", expected, fetcher),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(3);
      const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
      expect(urls.map((url) => url.pathname)).toEqual([
        "/youtube/v3/channels",
        "/youtube/v3/liveStreams",
        "/youtube/v3/liveBroadcasts",
      ]);
      expect(urls[0].searchParams.get("mine")).toBe("true");
      expect(urls[1].searchParams.get("id")).toBe(expected.streamId);
      expect(urls[2].searchParams.get("id")).toBe(expected.broadcastId);
      for (const [url, options] of fetcher.mock.calls) {
        expect(String(url)).not.toMatch(/cdn|ingestion|private-token/);
        expect(options).toMatchObject({
          method: "GET",
          cache: "no-store",
          headers: { authorization: "Bearer private-token" },
        });
      }
    },
  );

  it.each([
    { items: [] },
    { items: [{ id: "other-channel" }] },
    { items: [{ id: "channel-1" }, { id: "channel-1" }] },
    { items: [{ id: "channel-1" }], nextPageToken: "more" },
  ])(
    "never accepts resource absence without exact owner evidence %j",
    async (channel) => {
      const fetcher = responses(channel);
      await expect(
        verifyM4ProviderRetirement("token", expected, fetcher),
      ).rejects.toEqual(new Error("m4_retirement_unconfirmed"));
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {},
    { items: null },
    { items: [{ id: "stream-1" }] },
    { items: [{ id: "other-stream" }] },
    { items: [{ id: "stream-1" }, { id: "stream-1" }] },
    { items: [], nextPageToken: "more" },
    { items: [], prevPageToken: "previous" },
  ])(
    "rejects existing, malformed or partial stream evidence %j",
    async (stream) => {
      const fetcher = responses(owned, stream);
      await expect(
        verifyM4ProviderRetirement("token", expected, fetcher),
      ).rejects.toEqual(new Error("m4_retirement_unconfirmed"));
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    {},
    { items: [{ id: "broadcast-1" }] },
    { items: [{ id: "broadcast-1", status: {} }] },
    { items: [{ id: "broadcast-1", status: { lifeCycleStatus: "live" } }] },
    { items: [{ id: "other", status: { lifeCycleStatus: "complete" } }] },
    { items: [completed.items[0], completed.items[0]] },
    { items: [], nextPageToken: "more" },
  ])("rejects uncertain broadcast retirement %j", async (broadcast) => {
    const fetcher = responses(owned, { items: [] }, broadcast);
    await expect(
      verifyM4ProviderRetirement("token", expected, fetcher),
    ).rejects.toEqual(new Error("m4_retirement_unconfirmed"));
  });

  it.each([401, 403, 404, 429, 500])(
    "does not mistake HTTP %i for deletion",
    async (status) => {
      const fetcher = responses(owned);
      fetcher.mockResolvedValueOnce(
        new Response('{"error":{"message":"sensitive-provider-text"}}', {
          status,
        }),
      );
      await expect(
        verifyM4ProviderRetirement("token", expected, fetcher),
      ).rejects.toEqual(new Error("m4_retirement_unconfirmed"));
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps a lost inspection response uncertain without retry or raw error", async () => {
    const fetcher = responses(owned);
    fetcher.mockRejectedValueOnce(new Error("private-token"));
    await expect(
      verifyM4ProviderRetirement("token", expected, fetcher),
    ).rejects.toEqual(new Error("m4_retirement_unconfirmed"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("checks only supplied resources, while still verifying channel ownership", async () => {
    const fetcher = responses(owned, completed);
    await expect(
      verifyM4ProviderRetirement(
        "token",
        { channelId: "channel-1", broadcastId: "broadcast-1" },
        fetcher,
      ),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain("liveBroadcasts");
  });

  it("rejects invalid resource identifiers before any provider operation", async () => {
    const fetcher = responses();
    await expect(
      verifyM4ProviderRetirement(
        "token",
        { ...expected, streamId: "stream-1&other=2" },
        fetcher,
      ),
    ).rejects.toEqual(new Error("m4_retirement_unconfirmed"));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
