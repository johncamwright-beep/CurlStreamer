"use strict";

// Each attempt owns its resources and lease, including results arriving after cancellation.
class CameraSession {
  constructor({
    run,
    release,
    onError = () => {},
    onChange = () => {},
    schedule = setTimeout,
    unschedule = clearTimeout,
    nextSequence = (() => {
      let n = 0;
      return () => ++n;
    })(),
  }) {
    Object.assign(this, {
      run,
      release,
      onError,
      onChange,
      schedule,
      unschedule,
      nextSequence,
    });
    this.current = null;
    this.retryTimer = null;
    this.retries = 0;
  }
  async cleanup(attempt) {
    for (const dispose of attempt.resources.splice(0)) {
      try {
        await dispose();
      } catch {
        /* Continue releasing other resources. */
      }
    }
    if (attempt.lease && !attempt.released) {
      attempt.released = true;
      await this.release(attempt.lease).catch(() => {});
    }
  }
  disconnect() {
    if (this.retryTimer !== null) this.unschedule(this.retryTimer);
    this.retryTimer = null;
    const attempt = this.current;
    this.current = null;
    if (attempt) {
      attempt.cancelled = true;
      attempt.abort.abort();
    }
    this.onChange(false);
    return attempt ? this.cleanup(attempt) : Promise.resolve();
  }
  reconnect(attempt) {
    if (
      this.current !== attempt ||
      attempt.cancelled ||
      this.retryTimer !== null
    )
      return;
    if (this.retries++ >= 3) {
      this.onError(
        new Error(
          "Connection did not recover. Tap Connect camera to try again.",
        ),
      );
      return;
    }
    this.retryTimer = this.schedule(() => {
      this.retryTimer = null;
      if (this.current === attempt && !attempt.cancelled)
        void this.connect(false);
    }, 3000);
  }
  async connect(manual = true) {
    // Invalidate immediately; do not wait for an old network request before starting.
    void this.disconnect();
    if (manual) this.retries = 0;
    const attempt = {
      sequence: this.nextSequence(),
      resources: [],
      abort: new AbortController(),
      lease: null,
      released: false,
      cancelled: false,
    };
    this.current = attempt;
    attempt.check = () => {
      if (attempt.cancelled || this.current !== attempt)
        throw new Error("Camera attempt cancelled");
    };
    attempt.acquire = async (pending, dispose) => {
      const resource = await pending;
      attempt.resources.push(() => dispose(resource));
      attempt.check();
      return resource;
    };
    attempt.claim = async (pending) => {
      // Claim is deliberately not aborted: its eventual lease must be released.
      attempt.lease = (await pending).connectionId;
      attempt.check();
    };
    this.onChange(true);
    try {
      await this.run(attempt);
      attempt.check();
    } catch (error) {
      const owned = this.current === attempt && !attempt.cancelled;
      if (owned) {
        this.current = null;
        attempt.cancelled = true;
        attempt.abort.abort();
      }
      await this.cleanup(attempt);
      if (owned) {
        this.onChange(false);
        this.onError(error);
      }
    } finally {
      if (this.current === attempt) this.onChange(false);
    }
  }
}
if (typeof module !== "undefined") module.exports = { CameraSession };
