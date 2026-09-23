// Stream authority owns neither the browser nor the recording lifetime.
import { M4ApplicationOutput } from "./m4-application-output";
import type {
  M4DesktopClient,
  M4ProviderObservation,
} from "./m4-desktop-client";
import type { M4NativePipeClient, M4NativeObservation } from "./m4-native-pipe";
import { M4StudioRuntime } from "./m4-studio-runtime";

type Native = Pick<
  M4NativePipeClient,
  "arm" | "renew" | "stop" | "snapshot" | "disconnect"
> &
  Partial<Pick<M4NativePipeClient, "observe">>;
type State = "idle" | "starting" | "armed" | "stopping" | "stopped" | "failed";
const unavailable = () => new Error("m4_program_stream_unavailable");
export type M4StreamSnapshot = {
  state: State;
  localOutput?: {
    state: M4NativeObservation["state"] | "unknown";
    bytes: number;
  };
  provider?: M4ProviderObservation;
  liveConfirmed?: boolean;
};

/** One native connection, one target delivery. Armed is authority acceptance,
 * never evidence that an encoder sent packets or that YouTube received them. */
export class M4ProgramStream {
  #state: State = "idle";
  #abort?: AbortController;
  #closed?: Promise<void>;
  #stop?: Promise<void>;
  #local?: { value: M4NativeObservation; at: number };
  #provider?: { value: M4ProviderObservation; at: number };
  #localTimer?: ReturnType<typeof setTimeout>;
  #providerTimer?: ReturnType<typeof setTimeout>;
  constructor(private native: Native) {}

  snapshot(): M4StreamSnapshot {
    const native = this.native.snapshot();
    const local =
      this.#local && performance.now() - this.#local.at < 6000
        ? this.#local.value
        : undefined;
    const provider =
      this.#state === "armed" &&
      this.#provider &&
      performance.now() - this.#provider.at < 10000
        ? this.#provider.value
        : undefined;
    return {
      state:
        (this.#state === "armed" && native.state !== "armed") ||
        (this.#state === "idle" && native.state !== "connected")
          ? "failed"
          : this.#state,
      ...(this.native.observe
        ? {
            localOutput: {
              state: local?.state ?? "unknown",
              bytes: local?.bytes ?? 0,
            },
            ...(provider ? { provider } : {}),
            liveConfirmed: Boolean(
              this.#state === "armed" &&
              native.state === "armed" &&
              local?.state === "active" &&
              local.authority === 1 &&
              local.bytes > 0 &&
              provider?.streamStatus === "active" &&
              provider.broadcastLive,
            ),
          }
        : {}),
    };
  }

  async start(desktop: M4DesktopClient, intentId: string) {
    if (this.snapshot().state !== "idle" || !desktop.snapshot().authorized)
      throw unavailable();
    this.#state = "starting";
    this.#abort = new AbortController();
    const runtime = new M4StudioRuntime(
      new M4ApplicationOutput(desktop, this.native),
    );
    let ready!: () => void;
    let rejectReady!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => {
      ready = resolve;
      rejectReady = reject;
    });
    // Always observe lifetime failure, including after the caller has received
    // ARM acceptance. A failed stream must not escape as an unhandled rejection.
    this.#closed = runtime
      .run(intentId, this.#abort.signal, () => {
        if (this.#state !== "starting") return;
        this.#state = "armed";
        ready();
        if (this.native.observe) {
          void this.#observeLocal(this.#abort!.signal);
          void this.#observeProvider(desktop, intentId, this.#abort!.signal);
        }
      })
      .then(
        () => {
          this.#state = "stopped";
        },
        () => {
          this.#state = "failed";
        },
      )
      .finally(async () => {
        this.#clearPolling();
        await this.#finalObservation();
        this.native.disconnect();
        rejectReady(unavailable());
      });
    await started;
  }

  #clearPolling() {
    clearTimeout(this.#localTimer);
    clearTimeout(this.#providerTimer);
    this.#provider = undefined;
  }
  async #observeLocal(signal: AbortSignal) {
    const at = performance.now();
    try {
      const value = await this.native.observe!();
      if (!signal.aborted && this.#state === "armed") {
        this.#local = { value, at };
        if (value.authority !== 1 || value.state === "failed")
          this.#abort!.abort();
      }
    } catch {
      this.#local = undefined;
    }
    if (!signal.aborted && this.#state === "armed")
      this.#localTimer = setTimeout(() => {
        void this.#observeLocal(signal);
      }, 1000);
  }
  async #observeProvider(
    desktop: M4DesktopClient,
    intentId: string,
    signal: AbortSignal,
  ) {
    const at = performance.now();
    try {
      const value = await desktop.observeOutput(intentId);
      if (!signal.aborted && this.#state === "armed")
        this.#provider = { value, at };
    } catch {
      this.#provider = undefined;
    }
    if (!signal.aborted && this.#state === "armed")
      this.#providerTimer = setTimeout(() => {
        void this.#observeProvider(desktop, intentId, signal);
      }, 5000);
  }
  async #finalObservation() {
    if (!this.native.observe) return;
    // A STOP reply revokes authority. An independent status read is still
    // required before describing the actual local encoder as stopped.
    this.#local = undefined;
    const at = performance.now();
    try {
      this.#local = { value: await this.native.observe(), at };
    } catch {
      /* Missing status remains unknown, not a confirmed output stop. */
    }
  }

  stop() {
    return (this.#stop ??= (async () => {
      if (this.#closed) {
        if (this.#state !== "failed" && this.#state !== "stopped")
          this.#state = "stopping";
        this.#abort!.abort();
        this.#clearPolling();
        await this.#closed;
        if (this.#state === "failed") throw unavailable();
        return;
      }
      this.#state = "stopping";
      try {
        await this.native.stop();
        this.#state = "stopped";
      } catch {
        this.#state = "failed";
        throw unavailable();
      } finally {
        await this.#finalObservation();
        this.native.disconnect();
      }
    })());
  }
}
