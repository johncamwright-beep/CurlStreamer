/** Transfer a decoded bitmap to the caller, or close it if cancellation wins. */
export function decodeM4CameraBitmap(
  blob: Blob,
  signal: AbortSignal,
  decode: (blob: Blob) => Promise<ImageBitmap> = createImageBitmap,
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Camera bitmap decode cancelled", "AbortError"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(() => {
        if (signal.aborted)
          throw new DOMException(
            "Camera bitmap decode cancelled",
            "AbortError",
          );
        return decode(blob);
      })
      .then(
        (bitmap) => {
          if (settled) {
            bitmap.close();
            return;
          }
          settled = true;
          signal.removeEventListener("abort", abort);
          resolve(bitmap);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

const DECODE_TIMEOUT_MS = 2000;

/** Paint fresh frames with a cancellable image fallback when bitmap decoding
 * repeatedly fails. A source can retain at most two unfinished bitmap decodes. */
export function createM4CameraFramePainter(
  canvas: HTMLCanvasElement,
  onDecodeFailure?: (timedOut: boolean) => void,
  onFallback?: () => void,
) {
  const context = canvas.getContext("2d");
  let bitmapFailures = 0;
  let pendingBitmaps = 0;
  let useImage = false;
  return async (blob: Blob, signal: AbortSignal, isCurrent = () => true) => {
    if (signal.aborted || !isCurrent()) return;
    const attempt = new AbortController();
    const timeout = setTimeout(() => attempt.abort(), DECODE_TIMEOUT_MS);
    const combined = AbortSignal.any([signal, attempt.signal]);
    if (!useImage && (pendingBitmaps >= 2 || bitmapFailures >= 2)) {
      useImage = true;
      onFallback?.();
    }
    let bitmap: ImageBitmap | undefined;
    let releaseImage: (() => void) | undefined;
    try {
      let source: CanvasImageSource;
      let width: number;
      let height: number;
      if (useImage) {
        const image = new Image();
        const url = URL.createObjectURL(blob);
        releaseImage = () => {
          image.removeAttribute("src");
          URL.revokeObjectURL(url);
        };
        await new Promise<void>((resolve, reject) => {
          const abort = () =>
            finish(new DOMException("Image cancelled", "AbortError"));
          const finish = (error?: Error) => {
            combined.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            if (error) reject(error);
            else resolve();
          };
          if (combined.aborted) return abort();
          combined.addEventListener("abort", abort, { once: true });
          image.onload = () => finish();
          image.onerror = () => finish(new Error("Camera image decode failed"));
          image.src = url;
        });
        source = image;
        width = image.naturalWidth;
        height = image.naturalHeight;
      } else {
        bitmap = await decodeM4CameraBitmap(blob, combined, (input) => {
          pendingBitmaps++;
          return Promise.resolve()
            .then(() => createImageBitmap(input))
            .finally(() => pendingBitmaps--);
        });
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      }
      if (combined.aborted || !isCurrent()) return;
      if (!context || !width || !height)
        throw new Error("Camera frame unavailable");
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(source, 0, 0);
      bitmapFailures = 0;
      return { width, height };
    } catch {
      if (signal.aborted || !isCurrent()) return;
      onDecodeFailure?.(attempt.signal.aborted);
      if (!useImage) bitmapFailures++;
    } finally {
      clearTimeout(timeout);
      attempt.abort();
      bitmap?.close();
      releaseImage?.();
    }
  };
}
