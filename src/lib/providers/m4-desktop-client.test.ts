import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { M4DesktopClient } from "./m4-desktop-client";

const game = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const epoch = Date.parse("2026-09-08T10:00:00Z");
const bearer = "b".repeat(43),
  code = "c".repeat(43);
const row = {
  sessionId,
  generation: 1,
  expiresAt: new Date(epoch + 14_400_000).toISOString(),
  leaseExpiresAt: new Date(epoch + 30_000).toISOString(),
};
function response(value: unknown, serverTime = epoch) {
  return new Response(JSON.stringify(value), {
    headers: { date: new Date(serverTime).toUTCString() },
  });
}
function setup() {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ ...row, bearer }));
  const client = new M4DesktopClient(game, "https://pilot.example", {
    fetcher,
    clock: () => now,
  });
  return {
    client,
    fetcher,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
describe("in-memory M4 desktop capability client", () => {
  it("exposes a verifier-bound challenge and stores no publicly enumerable credentials", async () => {
    const { client, fetcher } = setup();
    expect(client.challenge).toMatch(/^[a-f0-9]{64}$/);
    await expect(client.exchange(code)).resolves.toEqual({
      state: "active",
      authorized: true,
    });
    const request = fetcher.mock.calls[0][1]!;
    const body = JSON.parse(String(request.body));
    expect(body.code).toBe(code);
    expect(body.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash("sha256").update(body.verifier).digest("hex")).toBe(
      client.challenge,
    );
    expect(request).toMatchObject({
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(request.headers).not.toHaveProperty("authorization");
    expect(JSON.stringify(client)).toBe("{}");
    expect(JSON.stringify(client.snapshot())).not.toContain(bearer);
  });
  it.each([
    "http://pilot.example",
    "https://user:pass@pilot.example",
    "https://pilot.example/",
    "https://pilot.example/?x=1",
    "https://pilot.example#fragment",
  ])("rejects noncanonical origin %s", (origin) => {
    expect(() => new M4DesktopClient(game, origin)).toThrow(
      /^m4_desktop_client_unavailable$/,
    );
  });
  it("will not repeat an uncertain exchange or expose the provider error", async () => {
    const { client, fetcher } = setup();
    fetcher.mockReset().mockRejectedValue(new Error(`private ${code}`));
    await expect(client.exchange(code)).rejects.toThrow(
      /^m4_desktop_client_unavailable$/,
    );
    await expect(client.exchange(code)).rejects.toThrow();
    await expect(client.heartbeat()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.snapshot().state).toBe("failed");
  });
  it("rejects missing server Date instead of trusting local wall clock", async () => {
    const { client, fetcher } = setup();
    fetcher
      .mockReset()
      .mockResolvedValue(new Response(JSON.stringify({ ...row, bearer })));
    await expect(client.exchange(code)).rejects.toThrow();
    expect(client.snapshot().authorized).toBe(false);
  });
  it("subtracts response latency and date precision from the initial lease", async () => {
    const { client, fetcher, advance } = setup();
    fetcher.mockReset().mockImplementation(async () => {
      advance(5_000);
      return response({ ...row, bearer });
    });
    await client.exchange(code);
    advance(23_999);
    expect(client.snapshot().authorized).toBe(true);
    advance(1);
    expect(client.snapshot()).toEqual({ state: "expired", authorized: false });
    await expect(client.heartbeat()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes only the lease and puts the original bearer exclusively in Authorization", async () => {
    const { client, fetcher, advance } = setup();
    await client.exchange(code);
    advance(10_000);
    fetcher.mockResolvedValueOnce(
      response(
        {
          ...row,
          leaseExpiresAt: new Date(epoch + 40_000).toISOString(),
          desiredAction: "wait",
        },
        epoch + 10_000,
      ),
    );
    await expect(client.heartbeat()).resolves.toMatchObject({
      authorized: true,
      desiredAction: "wait",
    });
    const request = fetcher.mock.calls[1][1]!;
    expect(request.headers).toMatchObject({
      authorization: `Bearer ${bearer}`,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      action: "heartbeat",
      sessionId,
      generation: 1,
    });
    expect(String(request.body)).not.toContain(bearer);
    advance(28_999);
    expect(client.snapshot().authorized).toBe(true);
    advance(1);
    expect(client.snapshot().authorized).toBe(false);
  });
  it("does not resurrect when a heartbeat response arrives after the old lease expired", async () => {
    const { client, fetcher, advance } = setup();
    await client.exchange(code);
    fetcher.mockImplementationOnce(async () => {
      advance(29_000);
      return response(
        {
          ...row,
          leaseExpiresAt: new Date(epoch + 59_000).toISOString(),
          desiredAction: "wait",
        },
        epoch + 29_000,
      );
    });
    await expect(client.heartbeat()).rejects.toThrow();
    expect(client.snapshot().state).toBe("expired");
  });
  it("serializes heartbeats and immediately fences an inflight heartbeat when stop is requested", async () => {
    const { client, fetcher } = setup();
    await client.exchange(code);
    const pending = deferred<Response>();
    fetcher
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    const heartbeat = client.heartbeat();
    const rejection = expect(heartbeat).rejects.toThrow();
    await Promise.resolve();
    const stop = client.stop();
    expect(client.snapshot()).toEqual({ state: "stopping", authorized: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending.resolve(response({ ...row, desiredAction: "wait" }));
    await rejection;
    await expect(stop).resolves.toEqual({
      state: "stopped",
      authorized: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(client.heartbeat()).rejects.toThrow();
    await client.stop();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("retains authority solely for stop cleanup when stop races exchange", async () => {
    const { client, fetcher } = setup();
    const pending = deferred<Response>();
    fetcher
      .mockReset()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    const exchange = client.exchange(code);
    const rejection = expect(exchange).rejects.toThrow();
    await Promise.resolve();
    const stop = client.stop();
    pending.resolve(response({ ...row, bearer }));
    await rejection;
    await expect(stop).resolves.toEqual({
      state: "stopped",
      authorized: false,
    });
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      authorization: `Bearer ${bearer}`,
    });
  });
  it("allows failed stop retry after lease expiration with the same bearer, until absolute expiry", async () => {
    const { client, fetcher, advance } = setup();
    await client.exchange(code);
    advance(40_000);
    fetcher.mockRejectedValueOnce(new Error("private-key"));
    await expect(client.stop()).rejects.toThrow(
      /^m4_desktop_client_unavailable$/,
    );
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    await client.stop();
    expect(fetcher.mock.calls[1][1]?.headers).toEqual(
      fetcher.mock.calls[2][1]?.headers,
    );
    expect(client.snapshot().state).toBe("stopped");
  });
  it("drops authority at absolute expiry and refuses further cleanup requests", async () => {
    const { client, fetcher, advance } = setup();
    await client.exchange(code);
    advance(14_400_000);
    await expect(client.stop()).rejects.toThrow();
    expect(client.snapshot().state).toBe("expired");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { generation: 2 },
    { sessionId: game },
    { desiredAction: "start" },
    { expiresAt: new Date(epoch + 20_000_000).toISOString() },
  ])("fails closed on inconsistent heartbeat authority %j", async (change) => {
    const { client, fetcher } = setup();
    await client.exchange(code);
    fetcher.mockResolvedValueOnce(
      response({ ...row, desiredAction: "wait", ...change }),
    );
    await expect(client.heartbeat()).rejects.toThrow(
      /^m4_desktop_client_unavailable$/,
    );
    expect(client.snapshot().authorized).toBe(false);
  });
  it("server stop revokes activity but preserves cleanup ability", async () => {
    const { client, fetcher } = setup();
    await client.exchange(code);
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    await expect(client.heartbeat()).resolves.toMatchObject({
      authorized: false,
      desiredAction: "stop",
    });
    await expect(client.heartbeat()).rejects.toThrow();
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    await client.stop();
  });
  it("bounds a stalled fetch even if the transport ignores abort", async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    fetcher.mockReset().mockReturnValue(new Promise(() => undefined));
    const result = client.exchange(code);
    const rejection = expect(result).rejects.toThrow(
      /^m4_desktop_client_unavailable$/,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(client.snapshot().authorized).toBe(false);
  });
});
