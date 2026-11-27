import { describe, expect, it, vi } from "vitest";
import {
  isSafeSponsorWebsite,
  normalizeSponsorWebsite,
  optimizedDimensions,
  snapshotSponsorFiles,
  uploadSponsorFiles,
} from "./sponsor-upload";

describe("multi-sponsor upload", () => {
  it("accepts optional HTTPS sponsor websites and rejects unsafe URLs", () => {
    expect(normalizeSponsorWebsite(" https://example.com/sponsor ")).toBe(
      "https://example.com/sponsor",
    );
    expect(normalizeSponsorWebsite("")).toBeUndefined();
    expect(isSafeSponsorWebsite("http://example.com")).toBe(false);
    expect(isSafeSponsorWebsite("https://user@example.com")).toBe(false);
  });
  it("never upscales and constrains wide, square, and portrait images", () => {
    expect(optimizedDimensions(800, 400)).toEqual({ width: 800, height: 400 });
    expect(optimizedDimensions(3200, 1600)).toEqual({
      width: 1600,
      height: 800,
    });
    expect(optimizedDimensions(2400, 2400)).toEqual({
      width: 1600,
      height: 1600,
    });
    expect(optimizedDimensions(1000, 3000)).toEqual({
      width: 533,
      height: 1600,
    });
  });
  const files = () => [
    new File(["a"], "first.png", { type: "image/png" }),
    new File(["b"], "second.webp", { type: "image/webp" }),
  ];

  it("snapshots selected files before the input can be cleared", () => {
    const source = files();
    const pending = snapshotSponsorFiles(source);
    source.length = 0;
    expect(pending.map((item) => item.file.name)).toEqual([
      "first.png",
      "second.webp",
    ]);
    expect(pending[0]).toMatchObject({ name: "first", altText: "first logo" });
  });

  it("uploads sequentially with progress", async () => {
    let concurrent = 0;
    let maximum = 0;
    const request = vi.fn(async (_form: FormData) => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await Promise.resolve();
      concurrent--;
      return new Response("{}", { status: 201 });
    });
    const progress = vi.fn();
    const outcomes = await uploadSponsorFiles(
      snapshotSponsorFiles(files()),
      request,
      progress,
      async (file) => file,
    );
    expect(outcomes.every((item) => item.ok)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    const firstMetadata = JSON.parse(
      (request.mock.calls[0][0] as FormData).get("metadata") as string,
    );
    expect(firstMetadata).toEqual([expect.objectContaining({ name: "first" })]);
    expect(maximum).toBe(1);
    expect(progress).toHaveBeenLastCalledWith(2, 2, "second.webp");
  });

  it("preserves success and retries only the failed stable identifier", async () => {
    const pending = snapshotSponsorFiles(files());
    let call = 0;
    const first = await uploadSponsorFiles(
      pending,
      async () => {
        call++;
        return call === 1
          ? new Response("{}", { status: 201 })
          : new Response(
              JSON.stringify({ error: "second.webp: invalid image" }),
              { status: 400 },
            );
      },
      undefined,
      async (file) => file,
    );
    expect(first.map((item) => item.ok)).toEqual([true, false]);
    expect(first[1].error).toContain("second.webp");
    const retry = await uploadSponsorFiles(
      first.filter((item) => !item.ok),
      async () => new Response("{}", { status: 201 }),
      undefined,
      async (file) => file,
    );
    expect(retry).toHaveLength(1);
    expect(retry[0].id).toBe(pending[1].id);
  });
});
