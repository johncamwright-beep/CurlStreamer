// Node-only managed lifetime. The native watchdog remains independent of this loop.
import type { M4ApplicationOutput } from "./m4-application-output";

type Output = Pick<
  M4ApplicationOutput,
  "start" | "heartbeat" | "stop" | "snapshot"
>;
const unavailable = () => new Error("m4_studio_runtime_unavailable");

/** One session, one handoff, no automatic restart. Owns heartbeat scheduling and
 * releases both authorities on cancellation, rejected renewal or pipe loss.
 * The caller must await run() and disconnect its pipe in a finally block. */
export class M4StudioRuntime {
  #used = false;
  #stopping = false;
  #stop?: Promise<void>;
  #wake?: () => void;
  constructor(private output: Output) {}

  stop() {
    this.#stopping = true;
    this.#wake?.();
    this.#stop ??= this.output.stop().then(() => undefined);
    return this.#stop;
  }

  async run(intentId: string, signal: AbortSignal, started?: () => void) {
    if (this.#used || this.#stopping) throw unavailable();
    this.#used = true;
    let failed = false;
    // Abort listeners must never leak a rejected cleanup promise.
    const abort = () => {
      void this.stop().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        abort();
        return;
      }
      await this.output.start(intentId);
      if (!this.#stopping) started?.();
      let renewalDelay = 5000;
      while (!this.#stopping) {
        const snapshot = this.output.snapshot();
        if (!snapshot.desktop.authorized || snapshot.native.state !== "armed")
          throw unavailable();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.#wake = undefined;
            resolve();
          }, renewalDelay);
          this.#wake = () => {
            clearTimeout(timer);
            this.#wake = undefined;
            resolve();
          };
        });
        if (this.#stopping) break;
        // Await each renewal before scheduling another; queue delay cannot
        // manufacture authority, and no missed heartbeat is replayed.
        const result = await this.output.heartbeat();
        // A transport timeout leaves only the previous verified lease. Retry
        // sooner instead of spending another five seconds of that lease idle.
        // Renewal remains serialized and only a server acknowledgement can
        // extend native authority. Rejection/expiry still stops the output.
        renewalDelay =
          "leaseRenewed" in result && result.leaseRenewed === false
            ? 1000
            : 5000;
        if (
          result.desktop.state === "stopped" &&
          result.native.state === "stopped"
        )
          break;
      }
    } catch {
      // Cancellation can reject an in-flight start/renewal after its fence is
      // raised. Confirmed cleanup still represents an ordinary operator Stop.
      failed = !this.#stopping;
    } finally {
      signal.removeEventListener("abort", abort);
      try {
        await this.stop();
      } catch {
        failed = true;
      }
      if (failed) throw unavailable();
    }
  }
}
