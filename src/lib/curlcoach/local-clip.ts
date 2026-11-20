import { z } from "zod";

export function localLaptopAddress(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !z.ipv4().safeParse(url.hostname).success ||
    !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)
  )
    throw Error(
      "Use the local http:// address shown in Studio’s Phone review settings.",
    );
  return url.origin;
}
export const localClipSchema = z
  .object({
    gameId: z.uuid(),
    duration: z.number().positive().max(125),
    minimum: z.number().nonnegative(),
    capturedAt: z.iso.datetime(),
  })
  .refine(
    (clip) =>
      clip.minimum < clip.duration &&
      clip.minimum >= Math.max(0, clip.duration - 120),
  );
export type LocalClip = z.infer<typeof localClipSchema> & { video: Blob };

/** Video crosses only between local browser windows, never through our servers. */
export function captureLocalClip(
  address: string,
  gameId: string,
  code: string,
  signal: AbortSignal,
): Promise<LocalClip> {
  const origin = localLaptopAddress(address);
  z.uuid().parse(gameId);
  const nonce = crypto.randomUUID();
  const opened = window.open(
    `${origin}/#mode=coach-capture&nonce=${nonce}`,
    "_blank",
  );
  if (!opened)
    return Promise.reject(
      Error(
        "Allow the laptop connection window, then tap Capture recent video again.",
      ),
    );
  const popup = opened;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(closed);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      popup.close();
    };
    const fail = (message: string) => {
      cleanup();
      reject(Error(message));
    };
    const abort = () => fail("Capture cancelled.");
    const timer = setTimeout(
      () =>
        fail(
          "Laptop did not respond. Check the same Wi-Fi, its address, and that Studio is running the game.",
        ),
      50000,
    );
    const closed = setInterval(() => {
      if (popup.closed)
        fail("Laptop connection closed before the clip arrived. Try again.");
    }, 750);
    function receive(event: MessageEvent) {
      if (
        event.source !== popup ||
        event.origin !== origin ||
        event.data?.nonce !== nonce
      )
        return;
      if (event.data.type === "coach-capture-window-ready") {
        popup.postMessage(
          { type: "coach-capture-connect", nonce, gameId, code },
          origin,
        );
      } else if (event.data.type === "coach-capture-error") {
        const message = z.string().max(300).safeParse(event.data.message);
        fail(message.success ? message.data : "Laptop capture failed.");
      } else if (event.data.type === "coach-capture-ready") {
        const clip = localClipSchema.safeParse(event.data);
        const video = event.data.video;
        if (
          !clip.success ||
          clip.data.gameId !== gameId ||
          !(video instanceof Blob) ||
          video.type !== "video/mp4" ||
          video.size === 0 ||
          video.size > 40 * 1024 * 1024
        ) {
          fail("The laptop returned an invalid clip. Reconnect and try again.");
          return;
        }
        popup.postMessage({ type: "coach-capture-received", nonce }, origin);
        cleanup();
        resolve({ ...clip.data, video });
      }
    }
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
