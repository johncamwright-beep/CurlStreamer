export const screenWakeUnavailableMessage =
  "Automatic screen wake is unavailable. Keep this phone unlocked.";

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/**
 * Owns an optional screen wake lock without coupling it to camera or room state.
 * A failed initial request gets at most one retry when the page becomes visible.
 */
export class OptionalScreenWakeLock {
  private sentinel: WakeLockSentinel | undefined;
  private requestFlight: Promise<void> | undefined;
  private active = false;
  private visibilityRetryUsed = false;

  constructor(
    private readonly browser: WakeLockNavigator,
    private readonly page: Pick<
      Document,
      "visibilityState" | "addEventListener" | "removeEventListener"
    >,
    private readonly onUnavailable: (message: string) => void,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.page.addEventListener("visibilitychange", this.handleVisibility);
    if (!this.browser.wakeLock) {
      this.onUnavailable(screenWakeUnavailableMessage);
      return;
    }
    if (this.page.visibilityState === "visible") this.request();
  }

  async release() {
    this.active = false;
    this.page.removeEventListener("visibilitychange", this.handleVisibility);
    await this.requestFlight;
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    await sentinel?.release();
  }

  private readonly handleVisibility = () => {
    if (
      !this.active ||
      this.page.visibilityState !== "visible" ||
      (this.sentinel && !this.sentinel.released) ||
      this.visibilityRetryUsed
    )
      return;
    this.visibilityRetryUsed = true;
    this.request();
  };

  private request() {
    if (!this.active || this.page.visibilityState !== "visible") return;
    const request = this.browser.wakeLock?.request;
    if (!request) {
      this.onUnavailable(screenWakeUnavailableMessage);
      return;
    }
    this.requestFlight = Promise.resolve()
      .then(() => request.call(this.browser.wakeLock, "screen"))
      .then(async (sentinel) => {
        if (!this.active) {
          await sentinel.release();
          return;
        }
        this.sentinel = sentinel;
      })
      .catch(() => this.onUnavailable(screenWakeUnavailableMessage))
      .finally(() => {
        this.requestFlight = undefined;
      });
  }
}
