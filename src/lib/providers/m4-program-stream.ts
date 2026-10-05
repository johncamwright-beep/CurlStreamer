// Stream authority owns neither the browser nor the recording lifetime.
import { M4ApplicationOutput } from "./m4-application-output";
import type {
  M4DesktopClient,
  M4ProviderObservation,
} from "./m4-desktop-client";
import type { M4NativePipeClient, M4NativeObservation } from "./m4-native-pipe";
import { M4StudioRuntime } from "./m4-studio-runtime";
import type { StudioDiagnostic } from "./m5-studio-diagnostics";

type Native = Pick<
  M4NativePipeClient,
  "arm" | "renew" | "stop" | "snapshot" | "disconnect"
> &
  Partial<Pick<M4NativePipeClient, "observe" | "pause" | "resume">>;
type State =
  "idle" | "starting" | "armed" | "paused" | "stopping" | "stopped" | "failed";
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
  #intentId?: string;
  #abort?: AbortController;
  #closed?: Promise<void>;
  #stop?: Promise<void>;
  #local?: { value: M4NativeObservation; at: number };
  #provider?: { value: M4ProviderObservation; at: number };
  #localTimer?: ReturnType<typeof setTimeout>;
  #providerTimer?: ReturnType<typeof setTimeout>;
  #failureReported = false;
  #controlFlight = false;
  #outputGeneration = 0;
  #authorized() {
    return this.#state === "armed" || this.#state === "paused";
  }
  constructor(
    private native: Native,
    private diagnostic?: StudioDiagnostic,
  ) {}

  #failed(
    reason:
      | "native_output_error"
      | "native_authority_lost"
      | "native_pipe_unavailable"
      | "stream_start_failed"
      | "stream_runtime_failed",
  ) {
    if (this.#failureReported) return;
    this.#failureReported = true;
    try {
      this.diagnostic?.("stream_failed", { reason });
    } catch {
      /* A diagnostic callback cannot change stream cleanup. */
    }
  }

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
        (this.#authorized() && native.state !== "armed") ||
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
    this.#intentId = intentId;
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
        try {
          this.diagnostic?.("stream_started");
        } catch {
          /* Evidence only. */
        }
        ready();
        if (this.native.observe) {
          void this.#observeLocal(this.#abort!.signal);
          void this.#observeProvider(desktop, intentId, this.#abort!.signal);
        }
      })
      .then(
        () => {
          this.#state = this.#failureReported ? "failed" : "stopped";
        },
        () => {
          this.#failed(
            this.#state === "starting"
              ? "stream_start_failed"
              : "stream_runtime_failed",
          );
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
      if (!signal.aborted && this.#authorized()) {
        this.#local = { value, at };
        if (value.authority !== 1 || value.state === "failed") {
          this.#failed(
            value.failure !== "none"
              ? "native_output_error"
              : "native_authority_lost",
          );
          this.#abort!.abort();
        }
      }
    } catch {
      this.#local = undefined;
      if (
        !signal.aborted &&
        this.#authorized() &&
        this.native.snapshot().state === "failed"
      ) {
        this.#failed("native_pipe_unavailable");
        this.#abort!.abort();
      }
    }
    if (!signal.aborted && this.#authorized())
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
    const generation = this.#outputGeneration;
    try {
      const value =
        this.#state === "armed"
          ? await desktop.observeOutput(intentId)
          : undefined;
      if (
        value &&
        !signal.aborted &&
        this.#state === "armed" &&
        generation === this.#outputGeneration
      )
        this.#provider = { value, at };
    } catch {
      if (generation === this.#outputGeneration) this.#provider = undefined;
    }
    if (!signal.aborted && this.#authorized())
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

  async confirmActiveOutput() {
    if (
      this.#state !== "armed" ||
      !this.native.observe ||
      this.#abort?.signal.aborted
    )
      throw unavailable();
    const value = await this.native.observe();
    if (
      this.#state !== "armed" ||
      this.#abort?.signal.aborted ||
      value.authority !== 1 ||
      value.failure !== "none" ||
      value.state !== "active" ||
      value.bytes <= 0
    )
      throw unavailable();
    this.#local = { value, at: performance.now() };
  }
  closingIdentity(desktop: M4DesktopClient) {
    const identity = desktop.closingIdentity();
    return identity &&
      this.#state === "armed" &&
      this.snapshot().localOutput?.state === "active" &&
      this.#intentId
      ? {
          ...identity,
          intentId: this.#intentId,
          capability: "final-card-v1" as const,
        }
      : null;
  }
  async pause() {
    if (
      this.#state !== "armed" ||
      this.#controlFlight ||
      !this.native.pause ||
      !this.native.observe
    )
      throw unavailable();
    this.#controlFlight = true;
    ++this.#outputGeneration;
    try {
      await this.native.pause();
      // Keep the heartbeat and camera program alive, but do not confirm pause
      // from the command acknowledgement alone.
      const until = performance.now() + 4000;
      while (this.#state === "armed" && !this.#abort?.signal.aborted) {
        const value = await this.native.observe();
        if (
          this.#state !== "armed" ||
          this.#abort?.signal.aborted ||
          value.authority !== 1 ||
          value.failure !== "none"
        )
          throw unavailable();
        this.#local = { value, at: performance.now() };
        if (value.state === "stopped") {
          this.#state = "paused";
          this.#provider = undefined;
          return;
        }
        if (performance.now() >= until) throw unavailable();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw unavailable();
    } finally {
      this.#controlFlight = false;
    }
  }
  async resume() {
    if (
      this.#state !== "paused" ||
      this.#controlFlight ||
      !this.native.resume ||
      this.#abort?.signal.aborted
    )
      throw unavailable();
    this.#controlFlight = true;
    ++this.#outputGeneration;
    try {
      await this.native.resume();
      if (this.#state !== "paused" || this.#abort?.signal.aborted)
        throw unavailable();
      this.#local = undefined;
      this.#provider = undefined;
      this.#state = "armed";
    } finally {
      this.#controlFlight = false;
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
