/** Abort Image.decode as well as fetch; Chromium can leave decode pending. */
export async function decodeM4CameraImage(
  image: Pick<HTMLImageElement, "decode" | "src">,
  signal: AbortSignal,
) {
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => {
        image.src = "";
        reject(new DOMException("Camera image decode cancelled", "AbortError"));
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      void image.decode().then(resolve, reject);
    });
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}
