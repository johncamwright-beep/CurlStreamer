import { ProgramVideoDelayQueue } from "../program-video-delay";
import { decodeM4CameraBitmap } from "./m4-camera-image-browser";

/** Decode on presentation, never retain seconds of full-resolution bitmaps. */
export function createProgramVideoPlayout({
  canvas,
  delayMs,
  onFrame,
  onStale,
}: {
  canvas: HTMLCanvasElement;
  delayMs: number;
  onFrame: (width: number, height: number) => void;
  onStale?: () => void;
}) {
  const queue = new ProgramVideoDelayQueue(delayMs);
  const context = canvas.getContext("2d");
  const lifetime = new AbortController();
  let revision = 0;
  let pendingDecodes = 0;
  let presenting = false;
  let lastPaintAt: number | undefined;
  let startedAt = performance.now();
  let stale = false;
  let timer: ReturnType<typeof setTimeout>;
  // This watchdog remains independent of a decoder's two-second timeout.
  const staleTimer = setInterval(() => {
    const now = performance.now();
    if (!stale && now - (lastPaintAt ?? startedAt + delayMs) >= 5000) {
      stale = true;
      revision++;
      queue.clear();
      context?.clearRect(0, 0, canvas.width, canvas.height);
      onStale?.();
    }
  }, 100);

  const paint = async () => {
    if (lifetime.signal.aborted) return;
    const started = performance.now();
    if (!presenting && pendingDecodes < 2 && context) {
      const blob = queue.takeDue(performance.now());
      if (blob) {
        presenting = true;
        const current = revision;
        const attempt = new AbortController();
        const timeout = setTimeout(() => attempt.abort(), 2000);
        let bitmap: ImageBitmap | undefined;
        try {
          bitmap = await decodeM4CameraBitmap(
            blob,
            AbortSignal.any([lifetime.signal, attempt.signal]),
            (input) => {
              pendingDecodes++;
              return Promise.resolve()
                .then(() => createImageBitmap(input))
                .finally(() => pendingDecodes--);
            },
          );
          if (
            !lifetime.signal.aborted &&
            !attempt.signal.aborted &&
            revision === current
          ) {
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            context.drawImage(bitmap, 0, 0);
            lastPaintAt = performance.now();
            stale = false;
            onFrame(bitmap.width, bitmap.height);
          }
        } catch {
          /* A failed decode skips this picture without replaying a backlog. */
        } finally {
          clearTimeout(timeout);
          attempt.abort();
          bitmap?.close();
          presenting = false;
        }
      }
    }
    if (!lifetime.signal.aborted)
      timer = setTimeout(
        () => void paint(),
        Math.max(0, 1000 / 30 - (performance.now() - started)),
      );
  };
  void paint();
  return {
    enqueue(blob: Blob, receivedAt = performance.now()) {
      if (!lifetime.signal.aborted) queue.enqueue(blob, receivedAt);
    },
    clear() {
      revision++;
      queue.clear();
      lastPaintAt = undefined;
      startedAt = performance.now();
      stale = false;
      context?.clearRect(0, 0, canvas.width, canvas.height);
    },
    isFresh() {
      return (
        lastPaintAt !== undefined && performance.now() - lastPaintAt < 5000
      );
    },
    stop() {
      lifetime.abort();
      clearTimeout(timer);
      clearInterval(staleTimer);
      revision++;
      queue.clear();
    },
  };
}
