import type { ConnectionDiagnosticInput } from "./connection-diagnostics";

export type ConnectionPhase =
  | "idle"
  | "capturing"
  | "waiting-studio"
  | "negotiating"
  | "streaming"
  | "retrying"
  | "blocked"
  | "stopped"
  | "connecting";

export class ConnectionFailure extends Error {
  constructor(
    public readonly code: ConnectionDiagnosticInput["code"],
    public readonly retryable: boolean,
    message: string = code,
  ) {
    super(message);
    this.name = "ConnectionFailure";
  }
}

export type ConnectionAttempt = {
  signal: AbortSignal;
  current(): boolean;
  phase(value: ConnectionPhase): void;
  fail(error: ConnectionFailure): void;
};

export type ConnectionState = {
  phase: ConnectionPhase;
  attempt: number;
  failures: number;
  retryInMs?: number;
  code?: ConnectionDiagnosticInput["code"];
};

type Deferred = { promise: Promise<void>; resolve(): void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Owns connection attempts, not browser capture consent or page wake locks. */
export class CameraConnectionCoordinator<T extends { stop(): void }> {
  private state: ConnectionState = { phase: "idle", attempt: 0, failures: 0 };
  private controller?: AbortController;
  private handle?: T;
  private flight?: Deferred;
  private replacement?: Deferred;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private retryDue = false;
  private closed = false;
  private readonly delays: number[];

  constructor(
    private readonly options: {
      connect(attempt: ConnectionAttempt): Promise<T>;
      release?(): void;
      canRetry?(): boolean;
      onState?(state: ConnectionState): void;
      retryDelays?: number[];
    },
  ) {
    this.delays = options.retryDelays?.length
      ? options.retryDelays.map((delay) => Math.max(0, delay))
      : [1000, 2000, 4000, 8000, 15000];
  }

  get snapshot(): ConnectionState {
    return { ...this.state };
  }

  start(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.replacement) return this.replacement.promise;
    if (this.flight) {
      if (this.controller && !this.controller.signal.aborted)
        return this.flight.promise;
      return this.restart();
    }
    if (this.controller && !this.controller.signal.aborted)
      return Promise.resolve();
    this.clearRetry();
    return this.launch();
  }

  restart(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.replacement) return this.replacement.promise;
    this.clearRetry();
    this.invalidate();
    if (!this.flight) return this.launch();
    this.replacement = deferred();
    this.publish({
      phase: "connecting",
      retryInMs: undefined,
      code: undefined,
    });
    return this.replacement.promise;
  }

  stop(): void {
    this.clearRetry();
    const queued = this.replacement;
    this.replacement = undefined;
    this.invalidate();
    queued?.resolve();
    this.publish({ phase: "stopped", retryInMs: undefined, code: undefined });
  }

  close(): void {
    this.closed = true;
    this.stop();
  }

  private safely(action: (() => void) | undefined): void {
    try {
      action?.();
    } catch {
      /* Observers cannot interrupt resource cleanup. */
    }
  }

  private publish(change: Partial<ConnectionState>): void {
    if (
      Object.entries(change).every(
        ([key, value]) => this.state[key as keyof ConnectionState] === value,
      )
    )
      return;
    this.state = { ...this.state, ...change };
    this.safely(() => this.options.onState?.(this.snapshot));
  }

  private clearRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryDue = false;
  }

  private invalidate(): void {
    const controller = this.controller;
    const handle = this.handle;
    this.controller = undefined;
    this.handle = undefined;
    clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
    this.safely(() => controller?.abort());
    this.safely(() => handle?.stop());
    this.safely(this.options.release);
  }

  private launch(): Promise<void> {
    const flight = deferred();
    const controller = new AbortController();
    this.flight = flight;
    this.controller = controller;
    this.publish({
      phase: "connecting",
      attempt: this.state.attempt + 1,
      retryInMs: undefined,
      code: undefined,
    });
    const current = () =>
      !this.closed &&
      this.controller === controller &&
      !controller.signal.aborted;
    const attempt: ConnectionAttempt = {
      signal: controller.signal,
      current,
      phase: (phase) => {
        if (!current()) return;
        if (phase !== "streaming") {
          clearTimeout(this.stableTimer);
          this.stableTimer = undefined;
        } else if (this.state.phase !== "streaming") {
          this.stableTimer = setTimeout(() => {
            if (current() && this.state.phase === "streaming")
              this.publish({ failures: 0 });
          }, 10_000);
        }
        this.publish({ phase });
      },
      fail: (error) => {
        if (current()) this.fail(error);
      },
    };
    // Invoke synchronously so capture can begin inside the user's gesture.
    let result: Promise<T>;
    try {
      result = this.options.connect(attempt);
    } catch (error) {
      result = Promise.reject(error);
    }
    void Promise.resolve(result)
      .then(
        (handle) => {
          if (current()) this.handle = handle;
          else this.safely(() => handle.stop());
        },
        (error: unknown) => {
          if (current()) this.fail(error);
        },
      )
      .finally(() => {
        if (this.flight !== flight) return;
        this.flight = undefined;
        flight.resolve();
        const replacement = this.replacement;
        if (replacement) {
          this.replacement = undefined;
          if (!this.closed) void this.launch().then(replacement.resolve);
          else replacement.resolve();
        } else if (this.retryDue && !this.closed) {
          this.retryDue = false;
          let permitted = false;
          try {
            permitted = this.options.canRetry?.() ?? true;
          } catch {
            /* Block on policy failure. */
          }
          if (permitted) void this.launch();
          else this.publish({ phase: "blocked", retryInMs: undefined });
        }
      });
    return flight.promise;
  }

  private fail(error: unknown): void {
    this.clearRetry();
    this.invalidate();
    const failure = error instanceof ConnectionFailure ? error : undefined;
    const failures = this.state.failures + 1;
    let allowed = false;
    try {
      allowed =
        failure?.retryable === true && (this.options.canRetry?.() ?? true);
    } catch {
      /* Block on policy failure. */
    }
    const code = failure?.code ?? "unknown_failure";
    if (!allowed) {
      this.publish({ phase: "blocked", failures, code, retryInMs: undefined });
      return;
    }
    const delay = this.delays[Math.min(failures - 1, this.delays.length - 1)];
    this.publish({ phase: "retrying", failures, code, retryInMs: delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      let permitted = false;
      try {
        permitted = this.options.canRetry?.() ?? true;
      } catch {
        /* Block on policy failure. */
      }
      if (this.closed || !permitted) {
        if (!this.closed)
          this.publish({ phase: "blocked", retryInMs: undefined });
        return;
      }
      if (this.flight) this.retryDue = true;
      else void this.launch();
    }, delay);
  }
}
