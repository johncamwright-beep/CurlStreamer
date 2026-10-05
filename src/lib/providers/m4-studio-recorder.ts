import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readM4RecorderReady } from "./m4-recorder-ready";
import { M4NativePipeClient } from "./m4-native-pipe";
import { M4ProgramStream } from "./m4-program-stream";
import type { StudioDiagnostic } from "./m5-studio-diagnostics";

/** A valid negative refresh acknowledgment leaves the inherited channel usable. */
export function readM4ProgramControlAck(
  tag: "RFR1" | "RFS1",
  id: number,
  ack: Buffer,
): "accepted" | "rejected" {
  if (ack.length !== (tag === "RFS1" ? 24 : 8) || ack.readUInt32LE(4) !== id)
    throw new Error("m4_recording_unavailable");
  const response = ack.subarray(0, 4).toString("ascii");
  if (tag === "RFR1" && response === "RFF1") return "rejected";
  if (response !== (tag === "RFS1" ? "RFP1" : "RFA1"))
    throw new Error("m4_recording_unavailable");
  return "accepted";
}

const localProgram = z
  .object({
    url: z
      .string()
      .regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/)
      .refine((value) => {
        try {
          return (
            Number(new URL(value).port || "80") > 0 &&
            Number(new URL(value).port || "80") <= 65535
          );
        } catch {
          return false;
        }
      }),
    cacheDirectory: z
      .string()
      .regex(/^[A-Za-z]:[\\/]/)
      .refine((value) => !value.includes("\0")),
  })
  .strict();

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("m4_recording_unavailable")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Owns the program recording and an optional independent stream output.
 * A private native pipe carries stream authority; only public paths and the
 * loopback renderer address enter process startup. No profile is created.
 */
export async function startM4StudioRecorder(paths: {
  executable: string;
  runtime: string;
  recording: string;
  previewOnly?: boolean;
  streamPlugin?: string;
  program?: { url: string; cacheDirectory: string };
  diagnostic?: StudioDiagnostic;
}) {
  const fail = () => new Error("m4_recording_unavailable");
  const root = process.env.SystemRoot;
  if (
    process.platform !== "win32" ||
    !root ||
    [
      paths.executable,
      paths.runtime,
      paths.recording,
      ...(paths.streamPlugin !== undefined ? [paths.streamPlugin] : []),
    ].some((path) => !/^[A-Za-z]:[\\/]/.test(path) || path.includes("\0"))
  )
    throw fail();
  const program = paths.program
    ? localProgram.safeParse(paths.program)
    : undefined;
  if (program && !program.success) throw fail();
  const source = program?.success ? program.data : undefined;
  const child = spawn(
    paths.executable,
    [
      "--parent-pid",
      String(process.pid),
      "--runtime",
      paths.runtime,
      paths.previewOnly ? "--preview-only" : "--recording",
      paths.previewOnly ? "-" : paths.recording,
      ...(source
        ? [
            "--program-cache",
            source.cacheDirectory,
            "--webrtc-ip-handling-policy=default",
            "--disable-features=WebRtcHideLocalIpsWithMdns",
          ]
        : []),
      ...(paths.streamPlugin ? ["--stream-plugin", paths.streamPlugin] : []),
      ...(source ? ["--program-control"] : []),
    ],
    {
      cwd: dirname(paths.executable),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        SystemRoot: root,
        PATH: `${paths.runtime};${join(root, "System32")}`,
        NODE_ENV: "production",
      },
    },
  );
  // A child closing stdin early must not produce an unhandled EPIPE.
  child.stdin.on("error", () => undefined);
  paths.diagnostic?.("native_started");
  if (source) {
    // Public loopback proof only. Future private grants require separate
    // browser-cache/log containment; they are rejected by this schema.
    const url = Buffer.from(source.url, "utf8");
    const frame = Buffer.alloc(4 + url.length);
    frame.writeUInt32LE(url.length);
    url.copy(frame, 4);
    child.stdin.write(frame, () => frame.fill(0));
  }
  let exited = false;
  let stream: M4ProgramStream | undefined;
  const closed = new Promise<{ finalized: boolean }>((resolve) => {
    child.once("error", () => {
      // A failed kill also emits error. Only a failed spawn proves that no
      // child exists; otherwise retain ownership until the actual exit event.
      if (child.pid !== undefined) return;
      paths.diagnostic?.("native_spawn_failed");
      exited = true;
      resolve({ finalized: false });
    });
    child.once("exit", (code) => {
      paths.diagnostic?.("native_exited", { exitCode: code });
      exited = true;
      resolve({ finalized: code === 0 });
    });
  });
  let stopPromise: Promise<void> | undefined;
  const stop = () =>
    (stopPromise ??= (async () => {
      // A stream failure must not prevent the MKV finalization request.
      await stream?.stop().catch(() => undefined);
      child.stdin.end();
      try {
        const result = await bounded(closed, 8000);
        if (!result.finalized) throw fail();
      } catch {
        if (!exited) child.kill();
        await bounded(closed, 3000).catch(() => undefined);
        throw fail();
      }
    })());
  try {
    const bootstrap = await readM4RecorderReady(
      child.stdout,
      Boolean(paths.streamPlugin),
      15000,
      Boolean(source),
    );
    if (bootstrap) {
      try {
        if (exited) throw fail();
        stream = new M4ProgramStream(
          await M4NativePipeClient.connect(
            bootstrap.pipe,
            bootstrap.capability,
            { observations: true },
          ),
          paths.diagnostic,
        );
      } finally {
        bootstrap.capability.fill(0);
      }
    }
    if (exited) throw fail();
    void closed.then(() => stream?.stop().catch(() => undefined));
    let requestId = 0;
    let controlFlight = false;
    let controlFailed = false;
    const command = async (tag: "RFR1" | "RFS1") => {
      if (!source || exited || stopPromise || controlFlight || controlFailed)
        throw fail();
      controlFlight = true;
      const id = ++requestId;
      if (id > 0xffffffff) {
        controlFlight = false;
        throw fail();
      }
      try {
        return await new Promise<Buffer>((resolve, reject) => {
          const ack = Buffer.alloc(tag === "RFS1" ? 24 : 8);
          let received = 0;
          let settled = false;
          const cleanup = () => {
            clearTimeout(timer);
            child.stdout.removeListener("data", data);
            child.stdout.removeListener("error", unavailable);
            child.stdout.removeListener("end", unavailable);
            child.removeListener("exit", unavailable);
          };
          const unavailable = () => {
            if (settled) return;
            settled = true;
            controlFailed = true;
            cleanup();
            ack.fill(0);
            reject(fail());
          };
          const data = (chunk: Buffer) => {
            if (!Buffer.isBuffer(chunk) || received + chunk.length > ack.length)
              return unavailable();
            chunk.copy(ack, received);
            received += chunk.length;
            chunk.fill(0);
            if (received !== ack.length) return;
            try {
              readM4ProgramControlAck(tag, id, ack);
            } catch {
              return unavailable();
            }
            settled = true;
            cleanup();
            resolve(ack);
          };
          const timer = setTimeout(unavailable, 5000);
          child.stdout.on("data", data);
          child.stdout.once("error", unavailable);
          child.stdout.once("end", unavailable);
          child.once("exit", unavailable);
          const request = Buffer.alloc(8);
          request.write(tag);
          request.writeUInt32LE(id, 4);
          child.stdin.write(request, (error) => {
            request.fill(0);
            if (error) unavailable();
          });
        });
      } finally {
        controlFlight = false;
      }
    };
    const refreshProgram = async () => {
      const ack = await command("RFR1");
      try {
        if (ack.subarray(0, 4).toString("ascii") === "RFF1") throw fail();
      } finally {
        ack.fill(0);
      }
    };
    const programHealth = async () => {
      const ack = await command("RFS1");
      try {
        const status = ack.readUInt32LE(20);
        if (status > 1) {
          controlFailed = true;
          throw fail();
        }
        return {
          rawSequence: ack.readUInt32LE(8),
          paintChanges: ack.readUInt32LE(12),
          ageMs: ack.readUInt32LE(16),
          active: status === 1,
        };
      } finally {
        ack.fill(0);
      }
    };
    return {
      stop,
      closed,
      refreshProgram,
      programHealth,
      ...(stream ? { stream } : {}),
    };
  } catch {
    await stop().catch(() => undefined);
    throw fail();
  }
}
