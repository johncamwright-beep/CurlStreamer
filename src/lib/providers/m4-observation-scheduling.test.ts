import { afterEach, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";

const gameId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const epoch = Date.parse("2026-09-30T12:00:00Z");
const authority = {
  sessionId,
  generation: 1,
  expiresAt: new Date(epoch + 14400000).toISOString(),
  leaseExpiresAt: new Date(epoch + 30000).toISOString(),
};
const observed = {
  intentId,
  sessionId,
  generation: 1,
  streamStatus: "active",
  healthStatus: "good",
  broadcastStatus: "live",
  broadcastLive: true,
};
function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { date: new Date(epoch).toUTCString() },
  });
}
async function fixture() {
  let clock = 0;
  const fetcher = vi.fn<typeof fetch>();
  fetcher
    .mockResolvedValueOnce(response({ ...authority, bearer: "b".repeat(43) }))
    .mockResolvedValueOnce(
      response({
        sessionId,
        generation: 1,
        intentId,
        phase: "reserved",
        deliveryRecorded: false,
      }),
    )
    .mockResolvedValueOnce(
      response({
        ...authority,
        intentId,
        target: {
          serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
          streamKey: "synthetic",
        },
      }),
    );
  const client = new M4DesktopClient(gameId, "https://pilot.example", {
    fetcher,
    clock: () => clock,
  });
  await client.exchange("c".repeat(43));
  await client.handoffOutput(intentId, async () => undefined);
  return {
    client,
    fetcher,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
afterEach(() => vi.useRealTimers());

it("renews the lease while a provider status read is stalled and coalesces duplicate reads", async () => {
  const { client, fetcher } = await fixture();
  let finish!: (value: Response) => void;
  fetcher.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  fetcher.mockResolvedValueOnce(
    response({ ...authority, desiredAction: "wait" }),
  );
  const observation = client.observeOutput(intentId);
  expect(client.observeOutput(intentId)).toBe(observation);
  await expect(client.observeOutput(gameId)).rejects.toThrow();
  await expect(client.heartbeat()).resolves.toMatchObject({
    leaseRenewed: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(JSON.parse(String(fetcher.mock.calls[4][1]?.body)).action).toBe(
    "heartbeat",
  );
  finish(response(observed));
  await expect(observation).resolves.toMatchObject({ broadcastLive: true });
});

it("sends Stop without waiting for a provider read and rejects its late success", async () => {
  const { client, fetcher } = await fixture();
  let finish!: (value: Response) => void;
  fetcher.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  fetcher.mockResolvedValueOnce(
    response({ ...authority, desiredAction: "stop" }),
  );
  const observation = client.observeOutput(intentId);
  const rejected = expect(observation).rejects.toThrow(
    "m4_desktop_client_unavailable",
  );
  await expect(client.stop()).resolves.toMatchObject({ state: "stopped" });
  finish(response(observed));
  await rejected;
  expect(client.snapshot().authorized).toBe(false);
});

it("times out a provider read without extending authority or preventing a later observation", async () => {
  vi.useFakeTimers();
  const { client, fetcher, advance } = await fixture();
  fetcher.mockReturnValueOnce(new Promise(() => undefined));
  const remaining = client.remainingLeaseMs();
  const rejected = expect(client.observeOutput(intentId)).rejects.toThrow();
  advance(12000);
  await vi.advanceTimersByTimeAsync(12000);
  await rejected;
  expect(client.remainingLeaseMs()).toBe(remaining - 12000);
  expect(client.snapshot().authorized).toBe(true);
  fetcher.mockResolvedValueOnce(response(observed));
  await client.observeOutput(intentId);
  advance(24000);
  await expect(client.observeOutput(intentId)).rejects.toThrow();
  expect(client.snapshot().state).toBe("expired");
  expect(fetcher).toHaveBeenCalledTimes(5);
});
