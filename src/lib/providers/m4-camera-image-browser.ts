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
