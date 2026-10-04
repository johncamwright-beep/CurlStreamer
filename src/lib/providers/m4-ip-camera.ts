// Node-only. Credentials live only in this manager and the helper's private stdin.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  ConnectionDiagnostic,
  ConnectionDiagnosticInput,
} from "./connection-diagnostics";
import { cameraRoleSchema, type CameraRole } from "../m2-studio-protocol";
import {
  m4CameraInputSchema,
  type M4CameraInput,
  type M4CameraInputSnapshot,
  type M4CameraInputError,
} from "../m4-camera-input";

const roles: CameraRole[] = ["camera-home", "camera-away"];
const maxJpeg = 2 * 1024 * 1024;
const maxAudio = 9600; // 100ms, mono 48kHz signed16.
const freshMs = 5000;
/** Windows environment names are case-insensitive. Do not inherit PATH variants
 * or application secrets into the native decoder process. */
function helperEnvironment(runtimePath: string): NodeJS.ProcessEnv {
  const pick = (name: string) => {
    const entry = Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    const value = entry?.[1];
    return value && !value.includes("\0") ? value : undefined;
  };
  const systemRoot = pick("SystemRoot");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    Path:
      runtimePath + (systemRoot ? `;${resolve(systemRoot, "System32")}` : ""),
  };
  if (systemRoot) env.SystemRoot = systemRoot;
  const temp = pick("TEMP"),
    tmp = pick("TMP");
  if (temp) env.TEMP = temp;
  if (tmp) env.TMP = tmp;
  return env;
}
const statusSchema = z
  .object({
    code: z.enum(["connecting", "auth_failed", "unavailable", "streaming"]),
  })
  .strict();
export type M4IpCameraFrame = {
  jpeg: Buffer;
  counter: number;
  generation: number;
};
type Slot = {
  role: CameraRole;
  config: M4CameraInput;
  generation: number;
  phase: M4CameraInputSnapshot["phase"];
  errorCode: M4CameraInputError;
  child?: ChildProcessWithoutNullStreams;
  retirement?: Promise<boolean>;
  retry?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setInterval>;
  frame?: M4IpCameraFrame;
  lastFrame?: number;
  healthySince?: number;
  launchedAt?: number;
  failures: number;
  counter: number;
  audio: Buffer;
  authBlocked?: boolean;
};

/** Checks the full JPEG envelope and SOF dimensions before retaining a frame. */
function validJpeg(data: Buffer) {
  if (
    data.length < 12 ||
    data.readUInt16BE(0) !== 0xffd8 ||
    data.readUInt16BE(data.length - 2) !== 0xffd9
  )
    return false;
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos++] !== 0xff) return false;
    while (data[pos] === 0xff) pos++;
    const marker = data[pos++];
    if (pos + 2 > data.length) return false;
    if (marker === 0xda || marker === 0xd9) return false;
    const length = data.readUInt16BE(pos);
    if (length < 2 || pos + length > data.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return false;
      const height = data.readUInt16BE(pos + 3),
        width = data.readUInt16BE(pos + 5);
      return width > 0 && width <= 1280 && height > 0 && height <= 4096;
    }
    pos += length;
  }
  return false;
}

export function createM4IpCameraManager(
  options: {
    helperPath?: string;
    runtimePath?: string;
    spawn?: typeof spawn;
    helperAvailable?: () => boolean;
    now?: () => number;
    diagnostic?: ConnectionDiagnostic;
  } = {},
) {
  const helperPath = options.helperPath ?? resolve("native/m4_ip_camera.exe");
  const runtimePath =
    options.runtimePath ?? process.env.CURLCAST_M4_OBS_RUNTIME ?? "";
  const available =
    options.helperAvailable ??
    (() =>
      Boolean(runtimePath) &&
      existsSync(helperPath) &&
      existsSync(runtimePath));
  const launch = options.spawn ?? spawn;
  const now = options.now ?? Date.now;
  let active = false;
  let disposed = false;
  const slots = Object.fromEntries(
    roles.map((role) => [
      role,
      {
        role,
        config: { kind: "phone" },
        generation: 0,
        phase: "idle",
        errorCode: null,
        failures: 0,
        counter: 0,
        audio: Buffer.alloc(0),
      },
    ]),
  ) as Record<CameraRole, Slot>;
  const slotFor = (role: CameraRole) => {
    if (!cameraRoleSchema.safeParse(role).success)
      throw Error("invalid_camera_role");
    return slots[role];
  };
  function diagnostic(slot: Slot, code: ConnectionDiagnosticInput["code"]) {
    try {
      options.diagnostic?.({ role: slot.role, layer: "media", code });
    } catch {
      /* Diagnostic persistence must not affect source capture. */
    }
  }
  function flush(slot: Slot) {
    slot.frame = undefined;
    slot.lastFrame = undefined;
    slot.healthySince = undefined;
    slot.audio.fill(0);
    slot.audio = Buffer.alloc(0);
  }
  function retire(slot: Slot) {
    clearTimeout(slot.retry);
    clearInterval(slot.watchdog);
    slot.retry = undefined;
    slot.watchdog = undefined;
    flush(slot);
    if (slot.retirement) return slot.retirement;
    const child = slot.child;
    if (!child) return Promise.resolve(true);
    slot.child = undefined;
    slot.retirement = new Promise<boolean>((done) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (exited: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.removeListener("close", closed);
        done(exited);
      };
      const closed = () => finish(true);
      child.once("close", closed);
      // Drain stderr, but never retain or expose native diagnostic text.
      child.stdin.end();
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* fixed status only */
        }
        timer = setTimeout(() => finish(false), 1000);
        timer.unref?.();
      }, 1000);
      timer.unref?.();
      if (child.exitCode !== null || child.signalCode !== null) finish(true);
    });
    const retirement = slot.retirement;
    // A process that refuses termination prevents further launches for this role.
    void retirement.then((exited) => {
      if (exited && slot.retirement === retirement) slot.retirement = undefined;
    });
    return retirement;
  }
  function failed(
    slot: Slot,
    generation: number,
    code: M4CameraInputError,
    retryable = true,
  ) {
    if (slot.generation !== generation || !active) return;
    slot.errorCode = code;
    diagnostic(
      slot,
      code === "auth_failed"
        ? "authority_rejected"
        : code === "invalid_pipe"
          ? "verification_failed"
          : code === "stale_frames"
            ? "verification_timeout"
            : "network_unavailable",
    );
    if (retryable) diagnostic(slot, "retry");
    if (code === "auth_failed") slot.authBlocked = true;
    slot.phase = retryable ? "retrying" : "failed";
    slot.failures++;
    const delay = Math.min(15000, 500 * 2 ** Math.min(slot.failures - 1, 5));
    void retire(slot).then((exited) => {
      if (
        slot.generation !== generation ||
        !active ||
        slot.config.kind !== "tapo"
      )
        return;
      if (!exited) {
        slot.phase = "failed";
        slot.errorCode = "unavailable";
        return;
      }
      if (!retryable) return;
      slot.retry = setTimeout(() => begin(slot), delay);
      slot.retry.unref?.();
    });
  }
  function begin(slot: Slot) {
    if (!active || slot.config.kind !== "tapo" || slot.child || slot.retirement)
      return;
    if (slot.authBlocked) {
      slot.phase = "failed";
      slot.errorCode = "auth_failed";
      return;
    }
    slot.generation++;
    const generation = slot.generation;
    flush(slot);
    if (!available()) {
      slot.phase = "failed";
      slot.errorCode = "runtime_missing";
      diagnostic(slot, "device_missing");
      return;
    }
    slot.phase = "connecting";
    diagnostic(slot, "started");
    slot.errorCode = null;
    slot.launchedAt = now();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = launch(helperPath, [runtimePath], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        cwd: runtimePath,
        env: helperEnvironment(runtimePath),
      }) as ChildProcessWithoutNullStreams;
    } catch {
      failed(slot, generation, "unavailable");
      return;
    }
    slot.child = child;
    let pending = Buffer.alloc(0);
    let terminal = false;
    const current = () =>
      !terminal &&
      active &&
      slot.generation === generation &&
      slot.child === child;
    const fail = (code: M4CameraInputError, retryable = true) => {
      if (!current()) return;
      terminal = true;
      pending = Buffer.alloc(0);
      failed(slot, generation, code, retryable);
    };
    child.stderr.on("data", () => {});
    child.stderr.on("error", () => {});
    child.stdin.on("error", () => fail("unavailable"));
    child.on("error", () => fail("unavailable"));
    child.on("close", () =>
      fail(pending.length ? "invalid_pipe" : "unavailable"),
    );
    child.stdout.on("end", () =>
      fail(pending.length ? "invalid_pipe" : "unavailable"),
    );
    child.stdout.on("error", () => fail("unavailable"));
    child.stdout.on("data", (chunk: Buffer) => {
      if (!current()) return;
      if (chunk.length + pending.length > maxJpeg * 2) {
        fail("invalid_pipe");
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      while (current() && pending.length >= 8) {
        const type = pending.toString("ascii", 0, 4);
        const length = pending.readUInt32LE(4);
        const limit =
          type === "JPEG"
            ? maxJpeg
            : type === "PCMA"
              ? maxAudio
              : type === "STAT"
                ? 128
                : 0;
        if (
          !limit ||
          !length ||
          length > limit ||
          (type === "PCMA" && length % 2)
        ) {
          fail("invalid_pipe");
          return;
        }
        if (pending.length < length + 8) break;
        const payload = pending.subarray(8, length + 8);
        pending = pending.subarray(length + 8);
        if (type === "JPEG") {
          if (!validJpeg(payload)) {
            fail("invalid_pipe");
            return;
          }
          const timestamp = now();
          if (slot.lastFrame !== undefined && timestamp - slot.lastFrame < 50)
            continue;
          if (slot.lastFrame === undefined)
            diagnostic(slot, slot.failures ? "recovered" : "ready");
          slot.frame = {
            jpeg: Buffer.from(payload),
            counter: ++slot.counter,
            generation,
          };
          slot.lastFrame = timestamp;
          slot.healthySince ??= timestamp;
          if (timestamp - slot.healthySince >= 10000) slot.failures = 0;
          slot.phase = "streaming";
          slot.errorCode = null;
        } else if (type === "PCMA") {
          if (slot.lastFrame === undefined || now() - slot.lastFrame >= freshMs)
            continue;
          const joined = Buffer.concat([slot.audio, payload]);
          slot.audio = Buffer.from(
            joined.subarray(Math.max(0, joined.length - maxAudio)),
          );
        } else {
          let status: z.infer<typeof statusSchema>;
          try {
            status = statusSchema.parse(JSON.parse(payload.toString("utf8")));
          } catch {
            fail("invalid_pipe");
            return;
          }
          if (status.code === "auth_failed") {
            fail("auth_failed", false);
            return;
          }
          if (status.code === "unavailable") {
            fail("unavailable");
            return;
          }
          // STAT streaming is never proof of frames actually advancing.
        }
      }
      // Copy a tiny remainder so it cannot retain an entire previous chunk.
      pending = Buffer.from(pending);
    });
    const { host, port, username, password, stream, rotation } = slot.config;
    child.stdin.write(
      JSON.stringify({
        version: 1,
        host,
        port,
        username,
        password,
        stream,
        rotation,
      }) + "\n",
    );
    slot.watchdog = setInterval(() => {
      if (!current()) return;
      if (
        slot.lastFrame === undefined
          ? now() - slot.launchedAt! >= 10000
          : now() - slot.lastFrame >= freshMs
      )
        fail("stale_frames");
    }, 250);
    slot.watchdog.unref?.();
  }
  function configure(role: CameraRole, input: unknown) {
    if (disposed) throw Error("camera_manager_closed");
    const result = m4CameraInputSchema.safeParse(input);
    if (!result.success) throw Error("invalid_camera_input");
    const slot = slotFor(role);
    slot.generation++;
    slot.config = result.data;
    slot.failures = 0;
    slot.authBlocked = false;
    slot.phase = "idle";
    slot.errorCode = null;
    const generation = slot.generation;
    const retirement = retire(slot);
    void retirement.then((exited) => {
      if (slot.generation !== generation) return;
      if (!exited) {
        slot.phase = "failed";
        slot.errorCode = "unavailable";
        return;
      }
      begin(slot);
    });
    return snapshot(role);
  }
  function snapshot(role: CameraRole): M4CameraInputSnapshot;
  function snapshot(): Record<CameraRole, M4CameraInputSnapshot>;
  function snapshot(
    role?: CameraRole,
  ): M4CameraInputSnapshot | Record<CameraRole, M4CameraInputSnapshot> {
    if (!role)
      return Object.fromEntries(
        roles.map((item) => [item, snapshot(item)]),
      ) as Record<CameraRole, M4CameraInputSnapshot>;
    const slot = slotFor(role),
      config = slot.config;
    const stale =
      slot.phase === "streaming" &&
      (slot.lastFrame === undefined || now() - slot.lastFrame >= freshMs);
    return {
      kind: config.kind,
      host: config.kind === "tapo" ? config.host : null,
      stream: config.kind === "tapo" ? config.stream : null,
      rotation: config.kind === "tapo" ? config.rotation : 0,
      configured: config.kind === "tapo",
      phase: stale ? "retrying" : slot.phase,
      errorCode: stale ? "stale_frames" : slot.errorCode,
      generation: slot.generation,
    };
  }
  return {
    configure,
    snapshot,
    reconnect(role: CameraRole) {
      return configure(role, slotFor(role).config);
    },
    async start() {
      if (disposed) throw Error("camera_manager_closed");
      if (active) return;
      active = true;
      for (const role of roles) {
        const slot = slots[role];
        if (slot.retirement && !(await slot.retirement)) continue;
        begin(slot);
      }
    },
    async stop() {
      active = false;
      const retired = await Promise.all(
        roles.map((role) => {
          const slot = slots[role];
          slot.generation++;
          if (slot.config.kind === "tapo") diagnostic(slot, "stopped");
          slot.phase = "idle";
          slot.errorCode = null;
          return retire(slot);
        }),
      );
      if (retired.some((exited) => !exited))
        throw Error("camera_cleanup_failed");
    },
    async close() {
      disposed = true;
      active = false;
      const retired = await Promise.all(
        roles.map((role) => {
          const slot = slots[role];
          slot.generation++;
          slot.config = { kind: "phone" };
          slot.phase = "idle";
          slot.errorCode = null;
          slot.authBlocked = false;
          return retire(slot);
        }),
      );
      if (retired.some((exited) => !exited))
        throw Error("camera_cleanup_failed");
    },
    latestFrame(role: CameraRole): M4IpCameraFrame | undefined {
      const slot = slotFor(role);
      if (
        !active ||
        slot.lastFrame === undefined ||
        now() - slot.lastFrame >= freshMs ||
        !slot.frame
      )
        return undefined;
      return { ...slot.frame, jpeg: Buffer.from(slot.frame.jpeg) };
    },
    takeAudio(role: CameraRole) {
      const slot = slotFor(role);
      const pcm =
        active &&
        slot.lastFrame !== undefined &&
        now() - slot.lastFrame < freshMs
          ? slot.audio
          : Buffer.alloc(0);
      slot.audio = Buffer.alloc(0);
      return { pcm, generation: slot.generation };
    },
  };
}
export type M4IpCameraManager = ReturnType<typeof createM4IpCameraManager>;
