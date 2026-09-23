// Node-only coordinator. Native launcher/bootstrap and OBS output-start UI are separate.
import type { M4DesktopClient } from "./m4-desktop-client";
import type { M4NativePipeClient } from "./m4-native-pipe";
const fail = () => new Error("m4_application_output_unavailable");

/** Connects once-only server handoff to the native pipe. Calls never retry target
 * delivery. The native process independently enforces the last acknowledged lease. */
export class M4ApplicationOutput {
  #started = false;
  #running = false;
  #stopping = false;
  #stop?: Promise<ReturnType<M4ApplicationOutput["snapshot"]>>;
  #heartbeat?: Promise<ReturnType<M4ApplicationOutput["snapshot"]>>;
  constructor(
    private desktop: M4DesktopClient,
    private native: Pick<
      M4NativePipeClient,
      "arm" | "renew" | "stop" | "snapshot"
    >,
  ) {}
  snapshot() {
    return { desktop: this.desktop.snapshot(), native: this.native.snapshot() };
  }
  async start(intentId: string) {
    if (this.#started || this.#stopping) throw fail();
    this.#started = true;
    try {
      await this.desktop.handoffOutput(intentId, async (target, remaining) => {
        if (this.#stopping) throw fail();
        await this.native.arm(target, remaining);
      });
      if (this.#stopping) throw fail();
      this.#running = true;
      return this.snapshot();
    } catch {
      await this.stop().catch(() => undefined);
      throw fail();
    }
  }
  heartbeat() {
    if (!this.#running || this.#stopping) return Promise.reject(fail());
    if (this.#heartbeat) return this.#heartbeat;
    this.#heartbeat = this.#renew().finally(() => {
      this.#heartbeat = undefined;
    });
    return this.#heartbeat;
  }
  async #renew() {
    try {
      const response = await this.desktop.heartbeat();
      if (
        response.desiredAction !== "wait" ||
        !response.authorized ||
        this.#stopping
      ) {
        await this.stop();
        return this.snapshot();
      }
      await this.native.renew(this.desktop.remainingLeaseMs());
      return this.snapshot();
    } catch {
      await this.stop().catch(() => undefined);
      throw fail();
    }
  }
  stop() {
    this.#stopping = true;
    this.#running = false;
    this.#stop ??= this.#cleanup();
    return this.#stop;
  }
  async #cleanup() {
    const results = await Promise.allSettled([
      this.native.stop(),
      this.desktop.stop(),
    ]);
    if (results.some((result) => result.status === "rejected")) throw fail();
    return this.snapshot();
  }
}
