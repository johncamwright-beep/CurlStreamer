export const screenWakeUnavailableMessage =
  "Automatic screen wake is unavailable. Keep this phone unlocked.";

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/**
 * Owns an optional screen wake lock without coupling it to camera or room state.
 * Requests again after each return to the page, with at most one recovery from
 * a system release per visible period. Denial never creates a retry loop.
 */
export class OptionalScreenWakeLock {
  private sentinel: WakeLockSentinel | undefined;
  private requestFlight: Promise<void> | undefined;
  private active = false;
  private releaseRetryUsed = false;
  private generation = 0;
  private recoveryPending = false;

  constructor(
    private readonly browser: WakeLockNavigator,
    private readonly page: Pick<
      Document,
      "visibilityState" | "addEventListener" | "removeEventListener"
    >,
    private readonly onUnavailable: (message: string) => void,
    private readonly onAvailable: () => void = () => undefined,
    private readonly diagnostic?: (
      event:
        | "wake_unsupported"
        | "wake_permission_denied"
        | "wake_released"
        | "wake_acquired"
        | "wake_unavailable",
    ) => void,
  ) {}
  private report(event: Parameters<NonNullable<typeof this.diagnostic>>[0]) {
    try {
      this.diagnostic?.(event);
    } catch {
      /* Wake-lock behavior cannot depend on a logger. */
    }
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
    this.releaseRetryUsed = false;
    this.page.addEventListener("visibilitychange", this.handleVisibility);
    if (!this.browser.wakeLock) {
      this.report("wake_unsupported");
      this.onUnavailable(screenWakeUnavailableMessage);
      return;
    }
    if (this.page.visibilityState === "visible") this.request();
  }

  async release() {
    this.active = false;
    this.generation += 1;
    this.recoveryPending = false;
    this.page.removeEventListener("visibilitychange", this.handleVisibility);
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    try {
      await sentinel?.release();
    } catch {
      // Closing the page remains safe when the browser already released it.
    }
    await this.requestFlight;
  }

  private readonly handleVisibility = () => {
    if (
      !this.active ||
      this.page.visibilityState !== "visible" ||
      (this.sentinel && !this.sentinel.released)
    )
      return;
    this.releaseRetryUsed = false;
    this.recoveryPending = true;
    this.request();
  };

  private request() {
    if (
      !this.active ||
      this.page.visibilityState !== "visible" ||
      this.requestFlight ||
      (this.sentinel && !this.sentinel.released)
    )
      return;
    const request = this.browser.wakeLock?.request;
    if (!request) {
      this.report("wake_unsupported");
      this.onUnavailable(screenWakeUnavailableMessage);
      return;
    }
    const generation = this.generation;
    this.recoveryPending = false;
    this.requestFlight = Promise.resolve()
      .then(() => request.call(this.browser.wakeLock, "screen"))
      .then(async (sentinel) => {
        if (!this.active || generation !== this.generation) {
          await sentinel.release();
          return;
        }
        this.sentinel = sentinel;
        sentinel.addEventListener?.(
          "release",
          () => {
            if (!this.active || this.sentinel !== sentinel) return;
            this.report("wake_released");
            this.sentinel = undefined;
            if (this.page.visibilityState !== "visible") return;
            if (this.releaseRetryUsed) {
              this.onUnavailable(screenWakeUnavailableMessage);
              return;
            }
            this.releaseRetryUsed = true;
            this.recoveryPending = true;
            this.request();
          },
          { once: true },
        );
        this.report("wake_acquired");
        this.onAvailable();
      })
      .catch((cause) => {
        if (this.active && generation === this.generation) {
          this.report(
            cause instanceof DOMException && cause.name === "NotAllowedError"
              ? "wake_permission_denied"
              : "wake_unavailable",
          );
          this.onUnavailable(screenWakeUnavailableMessage);
        }
      })
      .finally(() => {
        this.requestFlight = undefined;
        if (this.recoveryPending || generation !== this.generation)
          this.request();
      });
  }
}
