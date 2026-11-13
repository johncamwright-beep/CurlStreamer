// Node-only bootstrap for a trusted native launcher; never import in a browser.
import type { Readable } from "node:stream";

const bootstrapBytes = 296;
const unavailable = () => new Error("m4_studio_bootstrap_unavailable");

/** Production wire format, exactly 296 bytes followed by EOF:
 * 0: uint32 LE magic 0x4d344253; 4: uint16 LE version 1;
 * 6: uint16 LE reserved 0; 8: WCHAR pipe[128] (UTF-16LE, terminated
 * and zero padded); 264: capability[32]. No target, scenario or credentials
 * other than the pipe capability are accepted. The trusted launcher supplies
 * a dedicated inherited stdin pipe; arguments/environment are not consulted.
 * Received buffers are consumed and wiped. The caller owns the returned
 * capability and MUST wipe it after connecting (including failure paths).
 */
export function readM4StudioBootstrap(
  input: Readable,
  timeoutMs = 2000,
): Promise<{ pipe: string; capability: Buffer }> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const frame = Buffer.alloc(bootstrapBytes);
    let received = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", fail);
      input.removeListener("close", onClose);
      frame.fill(0);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      input.destroy();
      reject(unavailable());
    };
    const onClose = () => {
      if (!settled) fail();
    };
    const onData = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) {
        fail();
        return;
      }
      try {
        if (received + chunk.length > bootstrapBytes) {
          fail();
          return;
        }
        chunk.copy(frame, received);
        received += chunk.length;
      } finally {
        chunk.fill(0);
      }
    };
    const onEnd = () => {
      if (settled) return;
      if (
        received !== bootstrapBytes ||
        frame.readUInt32LE(0) !== 0x4d344253 ||
        frame.readUInt16LE(4) !== 1 ||
        frame.readUInt16LE(6) !== 0
      ) {
        fail();
        return;
      }
      let terminator = -1;
      for (let offset = 8; offset < 264; offset += 2) {
        if (frame.readUInt16LE(offset) === 0) {
          terminator = offset;
          break;
        }
      }
      const pipe = frame
        .subarray(8, Math.max(8, terminator))
        .toString("utf16le");
      if (
        terminator === -1 ||
        !frame.subarray(terminator, 264).every((byte) => byte === 0) ||
        !/^\\\\\.\\pipe\\curlstreamer-m4-[A-Za-z0-9-]{1,100}$/.test(pipe) ||
        frame.subarray(264).every((byte) => byte === 0)
      ) {
        fail();
        return;
      }
      const capability = Buffer.from(frame.subarray(264));
      settled = true;
      cleanup();
      resolve({ pipe, capability });
    };
    const timer = setTimeout(fail, timeoutMs);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", fail);
    input.once("close", onClose);
    if (input.destroyed || input.readableEnded) fail();
  });
}
