import { randomBytes } from "node:crypto";
import { z } from "zod";
const id = z.uuid(),
  max = 4 * 1024 * 1024,
  totalMax = 32 * 1024 * 1024,
  // Signed URLs rotate independently of object identity. Reuse verified bytes
  // for a bounded period when the organization-scoped storage path is stable.
  // A same-path replacement can take up to this interval to appear locally.
  fresh = 15 * 60_000,
  mimes = new Set(["image/jpeg", "image/png", "image/webp"]);
type Sponsor = { id: string; dataUrl: string; enabled: boolean };
type Asset = {
  path: string;
  source: string;
  at: number;
  mime: string;
  bytes: Buffer;
};
type Pending = {
  source: string;
  abort: AbortController;
  promise: Promise<void>;
};
const wait = <T>(p: Promise<T>, abort: AbortController) => {
  p.catch(() => undefined);
  if (abort.signal.aborted) return Promise.reject(new Error());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => abort.abort(), 5000);
    const failed = () => {
      done();
      reject(Error());
    };
    const done = () => {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", failed);
    };
    abort.signal.addEventListener("abort", failed, { once: true });
    p.then(
      (value) => {
        done();
        resolve(value);
      },
      (error) => {
        done();
        reject(error);
      },
    );
  });
};
export function createM4SponsorAssets(options: {
  storageOrigin: string;
  organizationId: string;
  fetcher?: typeof fetch;
}) {
  let origin: URL;
  try {
    origin = new URL(options.storageOrigin);
  } catch {
    throw Error("m4_sponsor_asset_unavailable");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== options.storageOrigin ||
    !id.safeParse(options.organizationId).success
  )
    throw Error("m4_sponsor_asset_unavailable");
  const assets = new Map<string, Asset>(),
    pending = new Map<string, Pending>(),
    allowed = new Map<string, string>(),
    fetcher = options.fetcher ?? fetch;
  let closed = false,
    used = 0,
    running = 0;
  const queue: Array<() => void> = [];
  const take = () =>
      new Promise<void>((resolve) =>
        running < 4
          ? (++running, resolve())
          : queue.push(() => (++running, resolve())),
      ),
    release = () => {
      --running;
      queue.shift()?.();
    };
  const drop = (key: string) => {
    const old = assets.get(key);
    if (old) {
      old.bytes.fill(0);
      used -= old.bytes.length;
      assets.delete(key);
    }
  };
  const source = (s: Sponsor) => {
    if (!id.safeParse(s.id).success) return;
    try {
      const u = new URL(s.dataUrl),
        pre = `/storage/v1/object/sign/organization-sponsors/${options.organizationId}/${s.id}.`;
      if (
        u.origin !== origin.origin ||
        u.username ||
        u.password ||
        !u.pathname.startsWith(pre) ||
        !/^(?:jpe?g|png|webp)$/.test(u.pathname.slice(pre.length)) ||
        !u.searchParams.has("token")
      )
        return;
      return u;
    } catch {
      return;
    }
  };
  const load = (s: Sponsor, url: URL) => {
    const old = pending.get(s.id);
    if (old?.source === url.pathname && !old.abort.signal.aborted)
      return old.promise;
    old?.abort.abort();
    const abort = new AbortController();
    const promise = (async () => {
      await take();
      const deadline = setTimeout(() => abort.abort(), 5000);
      try {
        if (closed || abort.signal.aborted) throw new Error();
        const response = await wait(
          fetcher(url, {
            redirect: "error",
            cache: "no-store",
            signal: abort.signal,
          }),
          abort,
        );
        const type = response.headers
            .get("content-type")
            ?.split(";", 1)[0]
            .toLowerCase(),
          length = Number(response.headers.get("content-length"));
        if (
          !response.ok ||
          response.redirected ||
          !type ||
          !mimes.has(type) ||
          (Number.isFinite(length) && length > max)
        )
          throw Error();
        const reader = response.body?.getReader();
        if (!reader) throw Error();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await wait(reader.read(), abort);
            if (part.done) break;
            size += part.value.length;
            if (size > max) throw Error();
            chunks.push(part.value);
          }
          if (
            closed ||
            allowed.get(s.id) !== url.pathname ||
            pending.get(s.id)?.abort !== abort ||
            used - (assets.get(s.id)?.bytes.length ?? 0) + size > totalMax
          )
            return;
          const bytes = Buffer.concat(chunks);
          drop(s.id);
          assets.set(s.id, {
            bytes,
            mime: type,
            source: url.pathname,
            at: Date.now(),
            path: `/sponsors/upload/${randomBytes(16).toString("hex")}`,
          });
          used += bytes.length;
        } finally {
          void reader.cancel().catch(() => undefined);
          for (const c of chunks) c.fill(0);
        }
      } catch {
        if (
          !closed &&
          allowed.get(s.id) === url.pathname &&
          pending.get(s.id)?.abort === abort
        )
          drop(s.id);
      } finally {
        clearTimeout(deadline);
        release();
        if (pending.get(s.id)?.abort === abort) pending.delete(s.id);
      }
    })();
    pending.set(s.id, { source: url.pathname, abort, promise });
    return promise;
  };
  return {
    async sync(sponsors: Sponsor[]) {
      if (closed) return [];
      const next = new Map<string, { s: Sponsor; url: URL }>();
      for (const s of sponsors) {
        const url = s.enabled ? source(s) : undefined;
        if (url && !next.has(s.id)) next.set(s.id, { s, url });
      }
      for (const key of new Set([
        ...assets.keys(),
        ...pending.keys(),
        ...allowed.keys(),
      ])) {
        const item = next.get(key);
        if (!item || allowed.get(key) !== item.url.pathname) {
          pending.get(key)?.abort.abort();
          drop(key);
        }
      }
      allowed.clear();
      for (const [key, item] of next) allowed.set(key, item.url.pathname);
      await Promise.all(
        [...next.values()].map(({ s, url }) => {
          const a = assets.get(s.id);
          return !a || a.source !== url.pathname || Date.now() - a.at >= fresh
            ? load(s, url)
            : undefined;
        }),
      );
      if (closed) return [];
      return sponsors.flatMap((s) =>
        s.dataUrl === "/sponsors/community.svg" ||
        s.dataUrl === "/sponsors/rock.svg"
          ? [s]
          : allowed.has(s.id) && assets.has(s.id)
            ? [{ ...s, dataUrl: assets.get(s.id)!.path }]
            : [],
      );
    },
    get(path: string) {
      return closed
        ? undefined
        : [...assets.values()].find((a) => a.path === path);
    },
    close() {
      closed = true;
      allowed.clear();
      for (const p of pending.values()) p.abort.abort();
      pending.clear();
      for (const key of [...assets.keys()]) drop(key);
    },
  };
}
