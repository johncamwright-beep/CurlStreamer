import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  prepareThumbnailImage,
  loadScheduledThumbnailMedia,
} from "./youtube-thumbnail-media";

const db = vi.hoisted(() => ({ maybeSingle: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: db.eq }) }),
  }),
}));
const organization = "11111111-1111-4111-8111-111111111111";
const source = `https://uploads.example/storage/v1/object/public/team-public-media/${organization}/abc123.png`;
const size = { width: 300, height: 200 };
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://uploads.example");
  db.eq.mockReturnValue({ maybeSingle: db.maybeSingle });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  "http://127.0.0.1/private",
  source.replace("uploads.example", "attacker.example"),
  source.replace(organization, "22222222-2222-4222-8222-222222222222"),
  source + "?redirect=https://attacker.example",
  source.replace("abc123.png", "..%2Fprivate.png"),
  source.replace("abc123.png", "nested/abc123.png"),
])("never fetches unapproved media: %s", async (url) => {
  const fetcher = vi.fn();
  expect(
    await prepareThumbnailImage(url, organization, size, fetcher),
  ).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves image proportions and alpha, disables redirects and reads fresh artwork", async () => {
  const bytes = await sharp({
    create: {
      width: 800,
      height: 100,
      channels: 4,
      background: { r: 200, g: 20, b: 20, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(bytes, { headers: { "Content-Type": "image/png" } }),
    );
  const result = await prepareThumbnailImage(
    source,
    organization,
    size,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledWith(
    new URL(source),
    expect.objectContaining({
      redirect: "error",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }),
  );
  const metadata = await sharp(
    Buffer.from(result!.split(",")[1], "base64"),
  ).metadata();
  expect(metadata.width).toBe(300);
  expect(metadata.height).toBe(38);
  expect(metadata.hasAlpha).toBe(true);
});

it("rejects oversized streaming media without buffering the rest", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(stream, { headers: { "Content-Type": "image/png" } }),
    );
  expect(
    await prepareThumbnailImage(source, organization, size, fetcher),
  ).toBeUndefined();
  expect(cancelled).toBe(true);
});

it("omits unavailable media instead of failing a scheduled game", async () => {
  db.maybeSingle.mockResolvedValue({ data: null, error: { code: "08006" } });
  expect(await loadScheduledThumbnailMedia(organization)).toEqual({});
  expect(db.eq).toHaveBeenCalledWith("organization_id", organization);
});
