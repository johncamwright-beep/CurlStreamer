import { ProgramVideoDelayQueue } from "../program-video-delay";
import { createM4CameraFramePainter } from "./m4-camera-image-browser";

/** Decode on presentation, never retain seconds of full-resolution bitmaps. */
export function createProgramVideoPlayout({
  canvas,
  delayMs,
  paintFrame,
  onFrame,
  onStale,
}: {
  canvas: HTMLCanvasElement;
  delayMs: number;
  paintFrame?: ReturnType<typeof createM4CameraFramePainter>;
  onFrame: (width: number, height: number) => void;
  onStale?: () => void;
}) {
  const queue = new ProgramVideoDelayQueue(delayMs);
  const context = canvas.getContext("2d");
  const paintCamera = paintFrame ?? createM4CameraFramePainter(canvas);
  const lifetime = new AbortController();
  let revision = 0;
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
    const blob = queue.takeDue(started);
    if (blob) {
      const current = revision;
      const frame = await paintCamera(
        blob,
        lifetime.signal,
        () => revision === current,
      );
      if (frame && !lifetime.signal.aborted && revision === current) {
        lastPaintAt = performance.now();
        stale = false;
        onFrame(frame.width, frame.height);
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
