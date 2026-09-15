// Node-only controller transport. Never import into browser components.
import { createConnection, type Socket } from "node:net";

export type M4NativeTarget = { serverUrl: string; streamKey: string };
export type M4NativeObservation = {
  state: "idle" | "connecting" | "active" | "stopped" | "failed";
  failure: "none" | "start-rejected" | "output-error";
  bytes: number;
  authority: number;
};
type PipeState = "connected" | "armed" | "stopped" | "failed";
const unavailable = () => new Error("m4_native_pipe_unavailable");

/** One connection and one target delivery. The trusted native launcher owns
 * pipe ACLs, peer PID validation and bootstrap; this client holds its capability
 * only in memory. A write or reply failure is terminal and never retried. */
export class M4NativePipeClient {
  #socket: Socket;
  #capability: Buffer;
  #state: PipeState = "connected";
  #sequence = 0;
  #attempted = false;
  #stopping = false;
  #queue: Promise<unknown> = Promise.resolve();
  #pending?: {
    sequence: number;
    bytes: number;
    resolve: (state: number) => void;
    reject: () => void;
  };
  #received = Buffer.alloc(0);
  #clock: () => number;
  #synthetic: boolean;
  #observations: boolean;
  #observation?: M4NativeObservation;

  private constructor(
    socket: Socket,
    capability: Buffer,
    synthetic: boolean,
    clock: () => number,
    observations: boolean,
  ) {
    this.#socket = socket;
    this.#capability = Buffer.from(capability);
    this.#synthetic = synthetic;
    this.#clock = clock;
    this.#observations = observations;
    socket.on("error", () => this.#fail());
    socket.on("close", () => {
      if (this.#state !== "stopped") this.#fail();
    });
    socket.on("data", (chunk: Buffer) => {
      if (
        !this.#pending ||
        this.#received.length + chunk.length > this.#pending.bytes
      ) {
        this.#fail();
        return;
      }
      this.#received = Buffer.concat([this.#received, chunk]);
      if (this.#received.length !== this.#pending.bytes) return;
      const row = this.#received;
      const pending = this.#pending;
      this.#received = Buffer.alloc(0);
      this.#pending = undefined;
      if (
        row.readUInt32LE(0) !== 0x4d344950 ||
        row.readUInt32LE(4) !== pending.sequence ||
        row.readUInt32LE(8) !== 0 ||
        row.readUInt32LE(12) > 2
      ) {
        pending.reject();
        this.#fail();
        return;
      }
      if (pending.bytes === 32) {
        const output = row.readUInt32LE(16),
          failure = row.readUInt32LE(20),
          bytes = row.readBigUInt64LE(24);
        if (
          output > 4 ||
          failure > 2 ||
          bytes > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          pending.reject();
          this.#fail();
          return;
        }
        this.#observation = {
          state: (
            ["idle", "connecting", "active", "stopped", "failed"] as const
          )[output],
          failure: (["none", "start-rejected", "output-error"] as const)[
            failure
          ],
          bytes: Number(bytes),
          authority: row.readUInt32LE(12),
        };
      }
      pending.resolve(row.readUInt32LE(12));
    });
  }

  static async connect(
    pipe: string,
    capability: Buffer,
    options: {
      synthetic?: boolean;
      clock?: () => number;
      observations?: boolean;
    } = {},
  ) {
    if (
      process.platform !== "win32" ||
      !/^\\\\\.\\pipe\\curlstreamer-m4-[A-Za-z0-9-]{1,100}$/.test(pipe) ||
      capability.length !== 32 ||
      capability.every((byte) => byte === 0)
    )
      throw unavailable();
    const socket = createConnection(pipe);
    const client = new M4NativePipeClient(
      socket,
      capability,
      options.synthetic === true,
      options.clock ?? (() => performance.now()),
      options.observations === true,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          client.#fail();
          reject(unavailable());
        }, 2000);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(timer);
          reject(unavailable());
        });
      });
      if (client.#state === "failed") throw unavailable();
      return client;
    } catch {
      client.#fail();
      throw unavailable();
    }
  }
  snapshot() {
    return { state: this.#state, deliveryAttempted: this.#attempted };
  }
  #fail() {
    if (this.#state !== "stopped") this.#state = "failed";
    const pending = this.#pending;
    this.#pending = undefined;
    this.#capability.fill(0);
    this.#received.fill(0);
    this.#received = Buffer.alloc(0);
    this.#socket.destroy();
    pending?.reject();
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }
  async #frame(opcode: number, payload: Buffer) {
    if (
      this.#state === "failed" ||
      (this.#state === "stopped" && opcode !== 4) ||
      this.#socket.destroyed ||
      this.#sequence >= 0xffffffff
    )
      throw unavailable();
    const sequence = ++this.#sequence;
    const frame = Buffer.alloc(52 + payload.length);
    frame.writeUInt32LE(0x4d344950, 0);
    frame.writeUInt32LE(1, 4);
    frame.writeUInt32LE(opcode, 8);
    frame.writeUInt32LE(payload.length, 12);
    frame.writeUInt32LE(sequence, 16);
    this.#capability.copy(frame, 20);
    payload.copy(frame, 52);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<number>((resolve, reject) => {
        this.#pending = {
          sequence,
          bytes: opcode === 4 ? 32 : 16,
          resolve,
          reject: () => reject(unavailable()),
        };
        timer = setTimeout(() => this.#fail(), 2000);
        this.#socket.write(frame, (error) => {
          if (error) this.#fail();
        });
      });
    } catch {
      this.#fail();
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      frame.fill(0);
      payload.fill(0);
    }
  }
  #remaining(deadline: number) {
    const remaining = Math.floor(deadline - this.#clock());
    if (!Number.isFinite(remaining) || remaining < 1 || remaining > 30000)
      throw unavailable();
    return remaining;
  }
  arm(target: M4NativeTarget, remainingLeaseMs: number) {
    if (this.#attempted || this.#stopping || this.#state !== "connected")
      return Promise.reject(unavailable());
    this.#attempted = true;
    const deadline = this.#clock() + remainingLeaseMs;
    return this.#serialize(async () => {
      const payload = Buffer.alloc(516);
      try {
        if (
          this.#stopping ||
          this.#state !== "connected" ||
          !target ||
          !(
            target.serverUrl === "rtmps://a.rtmps.youtube.com:443/live2" ||
            (this.#synthetic &&
              target.serverUrl === "rtmps://synthetic.invalid/live2")
          ) ||
          !/^[A-Za-z0-9_-]{1,255}$/.test(target.streamKey)
        )
          throw unavailable();
        payload.writeUInt32LE(this.#remaining(deadline), 0);
        payload.write(target.serverUrl, 4, 255, "ascii");
        payload.write(target.streamKey, 260, 255, "ascii");
        if (
          (await this.#frame(1, payload)) !== 1 ||
          this.#state !== "connected" ||
          this.#stopping ||
          this.#clock() >= deadline
        )
          throw unavailable();
        this.#state = "armed";
      } catch {
        this.#fail();
        throw unavailable();
      } finally {
        payload.fill(0);
      }
    });
  }
  renew(remainingLeaseMs: number) {
    const deadline = this.#clock() + remainingLeaseMs;
    return this.#serialize(async () => {
      const payload = Buffer.alloc(4);
      try {
        if (this.#stopping || this.#state !== "armed") throw unavailable();
        payload.writeUInt32LE(this.#remaining(deadline), 0);
        if (
          (await this.#frame(2, payload)) !== 1 ||
          this.#state !== "armed" ||
          this.#stopping ||
          this.#clock() >= deadline
        )
          throw unavailable();
      } catch {
        this.#fail();
        throw unavailable();
      } finally {
        payload.fill(0);
      }
    });
  }
  stop() {
    this.#stopping = true;
    return this.#serialize(async () => {
      if (this.#state === "stopped") return;
      if (this.#state === "failed") throw unavailable();
      try {
        if ((await this.#frame(3, Buffer.alloc(0))) !== 2) throw unavailable();
        this.#state = "stopped";
        if (!this.#observations) {
          this.#capability.fill(0);
          this.#socket.destroy();
        }
      } catch {
        this.#fail();
        throw unavailable();
      }
    });
  }
  observe() {
    return this.#serialize(async () => {
      if (!this.#observations) throw unavailable();
      this.#observation = undefined;
      await this.#frame(4, Buffer.alloc(0));
      if (!this.#observation) throw unavailable();
      return this.#observation as M4NativeObservation;
    });
  }
  disconnect() {
    this.#stopping = true;
    this.#fail();
  }
}
