import { expect, it, vi } from "vitest";
import { ChangedReadCache } from "./changed-read-cache";

it("reuses connected snapshots, refreshes on hints and falls back after ten seconds", async () => {
  let now = 0;
  const cache = new ChangedReadCache<number>(() => now);
  const load = vi.fn(async () => load.mock.calls.length);
  cache.connected = true;
  expect(await cache.read(load)).toBe(1);
  for (now = 1000; now < 10_000; now += 1000)
    expect(await cache.read(load)).toBe(1);
  expect(await cache.read(load)).toBe(2);
  cache.invalidate();
  expect(await cache.read(load)).toBe(3);
  cache.connected = false;
  expect(await cache.read(load)).toBe(4);
  expect(await cache.read(load)).toBe(5);
});
it("coalesces overlapping reads and retains an invalidation arriving during a read", async () => {
  const cache = new ChangedReadCache<number>();
  cache.connected = true;
  let finish!: (n: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const a = cache.read(load),
    b = cache.read(load);
  expect(load).toHaveBeenCalledTimes(1);
  cache.invalidate();
  finish(1);
  expect(await Promise.all([a, b])).toEqual([1, 1]);
  const fresh = vi.fn(async () => 2);
  expect(await cache.read(fresh)).toBe(2);
  expect(fresh).toHaveBeenCalledTimes(1);
});
it("does not extend freshness during slow reads or return stale data on failure", async () => {
  let now = 0;
  const cache = new ChangedReadCache<number>(() => now);
  cache.connected = true;
  await cache.read(async () => {
    now = 11_000;
    return 1;
  });
  await expect(
    cache.read(async () => {
      throw Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(await cache.read(async () => 2)).toBe(2);
  cache.clear();
  expect(await cache.read(async () => 3)).toBe(3);
});
