// Private inherited readiness channel; never expose its bootstrap to the UI.
import { Readable } from "node:stream";
import { readM4StudioBootstrap } from "./m4-studio-bootstrap";

export async function readM4RecorderReady(
  input: Readable,
  streaming: boolean,
  timeoutMs = 15000,
  keepOpen = false,
  presentation = false,
) {
  const fail = () => new Error("m4_recording_unavailable");
  const frame = Buffer.alloc((streaming ? 302 : 6) + (presentation ? 8 : 0));
  let received = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        input.removeListener("data", data);
        input.removeListener("end", end);
        input.removeListener("close", closed);
        input.removeListener("error", failed);
      };
      const failed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        input.destroy();
        reject(fail());
      };
      const data = (chunk: unknown) => {
        if (!Buffer.isBuffer(chunk)) return failed();
        try {
          if (received + chunk.length > frame.length) return failed();
          chunk.copy(frame, received);
          received += chunk.length;
          const prefixLength = Math.min(received, 6);
          if (
            !frame
              .subarray(0, prefixLength)
              .equals(Buffer.from("READY\n").subarray(0, prefixLength))
          )
            failed();
          if (keepOpen && received === frame.length && !settled) {
            settled = true;
            cleanup();
            resolve();
          }
        } finally {
          chunk.fill(0);
        }
      };
      const end = () => {
        if (received !== frame.length) return failed();
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const closed = () => {
        if (!settled) failed();
      };
      const timer = setTimeout(failed, timeoutMs);
      input.on("data", data);
      input.once("end", end);
      input.once("close", closed);
      input.once("error", failed);
      if (input.destroyed || input.readableEnded) failed();
    });
    if (
      presentation &&
      !frame.subarray(6, 14).equals(Buffer.from([80, 67, 86, 49, 1, 0, 0, 0]))
    )
      throw fail();
    return streaming
      ? await readM4StudioBootstrap(
          Readable.from([frame.subarray(presentation ? 14 : 6)]),
        )
      : undefined;
  } catch {
    throw fail();
  } finally {
    frame.fill(0);
  }
}
