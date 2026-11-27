import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
const n = z.number().finite().nonnegative();
export const nativeHealthSchema = z
  .object({
    capturedAt: n.int(),
    targetKbps: n,
    sentKbps: n,
    congestion: n.max(1),
    droppedFrames: n.int(),
    totalFrames: n.int(),
    adaptiveBitrate: z.boolean(),
    renderFps: n.max(240),
    renderMs: n,
    renderSkippedFrames: n.int(),
  })
  .strip();
export function nativeHealthReader(directory: string, now = Date.now) {
  let checkedAt = -Infinity;
  let latest: z.infer<typeof nativeHealthSchema> | null = null;
  return () => {
    const timestamp = now();
    if (timestamp - checkedAt < 2000) return latest;
    checkedAt = timestamp;
    let fd: number | undefined;
    try {
      fd = openSync(join(directory, "studio-health.json"), "r");
      const size = fstatSync(fd).size;
      if (size < 2 || size > 4096) throw Error("invalid_local_measurements");
      const bytes = Buffer.alloc(size);
      if (readSync(fd, bytes, 0, size, 0) !== size)
        throw Error("incomplete_local_measurements");
      const parsed = nativeHealthSchema.parse(
        JSON.parse(bytes.toString("utf8")),
      );
      latest =
        timestamp - parsed.capturedAt <= 10000 && timestamp >= parsed.capturedAt
          ? parsed
          : null;
    } catch {
      latest = null;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return latest;
  };
}
