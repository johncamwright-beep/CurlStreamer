import { describe, expect, it, vi } from "vitest";
import { createM4SponsorAssets } from "./m4-sponsor-assets";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sponsorId = "22222222-2222-4222-8222-222222222222";
const signed = `https://storage.invalid/storage/v1/object/sign/organization-sponsors/${organizationId}/${sponsorId}.webp?token=private`;
const sponsor = { id: sponsorId, dataUrl: signed, enabled: true };
const response = (
  body: string,
  headers: Record<string, string> = { "content-type": "image/webp" },
) => new Response(body, { status: 200, headers });

describe("M4 sponsor asset proxy", () => {
  it("aborts queued loads before fetch and closes despite a stalled body cancellation", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const read = vi.fn(
      () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
    );
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          redirected: false,
          headers: new Headers({ "content-type": "image/png" }),
          body: { getReader: () => ({ read, cancel }) },
        }) as unknown as Response,
    );
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    try {
      const five = Array.from({ length: 5 }, (_, index) => {
        const id = `22222222-2222-4222-8222-22222222222${index}`;
        return { ...sponsor, id, dataUrl: signed.replace(sponsorId, id) };
      });
      const pending = assets.sync(five);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(read).toHaveBeenCalledTimes(4);
      assets.close();
      await expect(pending).resolves.toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(cancel).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
      expect(await assets.sync(five)).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      assets.close();
      vi.useRealTimers();
    }
  });

  it("bounds total body duration even when chunks continue arriving", async () => {
    vi.useFakeTimers();
    let chunks = 0;
    const read = vi.fn(
      () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          setTimeout(() => {
            ++chunks;
            resolve({ done: false, value: new Uint8Array([1]) });
          }, 2000);
        }),
    );
    const cancel = vi.fn(async () => undefined);
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          redirected: false,
          headers: new Headers({ "content-type": "image/png" }),
          body: { getReader: () => ({ read, cancel }) },
        }) as unknown as Response,
    );
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    try {
      const pending = assets.sync([sponsor]);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual([]);
      expect(chunks).toBe(2);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      assets.close();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it("returns only opaque local paths and revokes removed assets", async () => {
    const fetcher = vi.fn(async () => response("pixels"));
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    const projected = await assets.sync([sponsor]);
    expect(projected[0].dataUrl).toMatch(/^\/sponsors\/upload\/[a-f0-9]{32}$/);
    expect(JSON.stringify(projected)).not.toContain("token=private");
    expect(assets.get(projected[0].dataUrl)).toMatchObject({
      mime: "image/webp",
    });
    await assets.sync([]);
    expect(assets.get(projected[0].dataUrl)).toBeUndefined();
  });

  it("reuses a stable object path across signed-URL rotation for 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetcher = vi.fn(async () => response("pixels"));
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    try {
      await assets.sync([sponsor]);
      await assets.sync([
        { ...sponsor, dataUrl: signed.replace("token=private", "token=rotated") },
      ]);
      expect(fetcher).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(15 * 60_000 - 1);
      await assets.sync([sponsor]);
      expect(fetcher).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1);
      await assets.sync([sponsor]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      assets.close();
      vi.useRealTimers();
    }
  });

  it("rejects foreign paths, redirects, oversized bodies, and unsupported mime", async () => {
    const cases: Array<[typeof sponsor, unknown]> = [
      [
        {
          ...sponsor,
          dataUrl: signed.replace("storage.invalid", "evil.invalid"),
        },
        undefined,
      ],
      [sponsor, { ...response("x"), redirected: true }],
      [sponsor, response("x", { "content-type": "image/svg+xml" })],
      [
        sponsor,
        response("x", {
          "content-type": "image/png",
          "content-length": String(4 * 1024 * 1024 + 1),
        }),
      ],
    ];
    for (const [candidate, value] of cases) {
      const fetcher = vi.fn(async () => value as Response);
      const assets = createM4SponsorAssets({
        storageOrigin: "https://storage.invalid",
        organizationId,
        fetcher,
      });
      expect(await assets.sync([candidate])).toEqual([]);
    }
  });

  it("does not resurrect an asset when a newer projection removes it", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(
      () => new Promise<Response>((done) => (resolve = done)),
    );
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    const old = assets.sync([sponsor]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(await assets.sync([])).toEqual([]);
    resolve(response("late"));
    expect(await old).toEqual([]);
    expect(assets.get("/sponsors/upload/not-present")).toBeUndefined();
  });

  it("coalesces overlapping identical projections", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(
      () => new Promise<Response>((done) => (resolve = done)),
    );
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    const first = assets.sync([sponsor]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const second = assets.sync([sponsor]);
    resolve(response("shared"));
    const [a, b] = await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(a[0].dataUrl).toMatch(/^\/sponsors\/upload\//);
    expect(b[0].dataUrl).toBe(a[0].dataUrl);
  });

  it("does not let an aborted old request win after remove and readd", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const fetcher = vi.fn(
      () => new Promise<Response>((done) => resolvers.push(done)),
    );
    const assets = createM4SponsorAssets({
      storageOrigin: "https://storage.invalid",
      organizationId,
      fetcher,
    });
    const old = assets.sync([sponsor]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await assets.sync([]);
    const current = assets.sync([sponsor]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    resolvers[0](response("old"));
    resolvers[1](response("new"));
    await old;
    expect((await current)[0].dataUrl).toMatch(/^\/sponsors\/upload\//);
  });
});
