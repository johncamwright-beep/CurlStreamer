import { describe, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";

const game = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const otherIntent = "44444444-4444-4444-8444-444444444444";
const epoch = Date.parse("2026-09-08T10:00:00Z");
const row = {
  sessionId,
  generation: 1,
  expiresAt: new Date(epoch + 14_400_000).toISOString(),
  leaseExpiresAt: new Date(epoch + 30_000).toISOString(),
};
const target = {
  serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
  streamKey: "private-stream-canary",
};
const observation = {
  intentId,
  sessionId,
  generation: 1,
  streamStatus: "active",
  healthStatus: "good",
  broadcastStatus: "live",
  broadcastLive: true,
};
function response(value: unknown, offset = 0) {
  return new Response(JSON.stringify(value), {
    headers: { date: new Date(epoch + offset).toUTCString() },
  });
}
async function paired() {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ ...row, bearer: "b".repeat(43) }));
  const client = new M4DesktopClient(game, "https://pilot.example", {
    fetcher,
    clock: () => now,
  });
  await client.exchange("c".repeat(43));
  return { client, fetcher, advance: (ms: number) => (now += ms) };
}
async function handedOff() {
  const fixture = await paired();
  fixture.fetcher
    .mockResolvedValueOnce(
      response({
        intentId,
        sessionId,
        generation: 1,
        phase: "reserved",
        deliveryRecorded: false,
      }),
    )
    .mockResolvedValueOnce(response({ ...row, intentId, target }));
  await fixture.client.handoffOutput(
    intentId,
    vi.fn().mockResolvedValue(undefined),
  );
  return fixture;
}

describe("desktop provider observation client", () => {
  it("does not observe before a successful handoff or for another intent", async () => {
    const { client, fetcher } = await paired();
    await expect(client.observeOutput(intentId)).rejects.toThrow(
      "m4_desktop_client_unavailable",
    );
    await expect(client.observeOutput(otherIntent)).rejects.toThrow(
      "m4_desktop_client_unavailable",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requests observe after handoff and releases only safe status fields", async () => {
    const { client, fetcher } = await handedOff();
    fetcher.mockResolvedValueOnce(response(observation));
    await expect(client.observeOutput(intentId)).resolves.toEqual({
      streamStatus: "active",
      healthStatus: "good",
      broadcastStatus: "live",
      broadcastLive: true,
    });
    expect(String(fetcher.mock.calls[3][0])).toContain("/observe");
  });
  it.each([
    { sessionId: game },
    { generation: 2 },
    { intentId: otherIntent },
    { broadcastStatus: "ready", broadcastLive: true },
  ])("rejects mismatched or optimistic observation %o", async (change) => {
    const { client, fetcher } = await handedOff();
    fetcher.mockResolvedValueOnce(response({ ...observation, ...change }));
    await expect(client.observeOutput(intentId)).rejects.toThrow(
      "m4_desktop_client_unavailable",
    );
  });
  it("fences an observation that arrives after stop", async () => {
    const { client, fetcher } = await handedOff();
    let release!: (value: Response) => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    fetcher.mockImplementationOnce(() => {
      entered();
      return new Promise<Response>((resolve) => (release = resolve));
    });
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    const pending = client.observeOutput(intentId);
    await enteredPromise;
    const stopping = client.stop();
    release(response(observation));
    await expect(pending).rejects.toThrow("m4_desktop_client_unavailable");
    await stopping;
  });
  it("does not renew the lease or repeat target delivery, and normalizes observe failures", async () => {
    const { client, fetcher, advance } = await handedOff();
    fetcher.mockRejectedValueOnce(new Error("private-provider-canary"));
    await expect(client.observeOutput(intentId)).rejects.toThrow(
      /^m4_desktop_client_unavailable$/,
    );
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/target")),
    ).toHaveLength(1);
    advance(29_001);
    await expect(client.observeOutput(intentId)).rejects.toThrow(
      "m4_desktop_client_unavailable",
    );
    expect(client.snapshot()).toEqual({ state: "expired", authorized: false });
  });
});
