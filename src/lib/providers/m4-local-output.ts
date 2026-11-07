// Node controller core only; no browser route or real encoder is wired to it.
// A production port must keep its destination in memory and enforce the
// authenticated desktop grant. Stock OBS SetStreamServiceSettings saves to disk
// and therefore must not implement this port.
import { z } from "zod";

export type LocalOutputTarget = { server: string; key: string };
export type OutputObservation = { active: boolean; reconnecting: boolean };
export interface MemoryOutputPort {
  start(target: LocalOutputTarget): Promise<void>;
  stop(): Promise<void>;
  observe(): Promise<OutputObservation>;
}
const leaseSchema = z
  .object({
    sessionId: z.uuid(),
    generation: z.number().int().positive(),
    expiresAt: z.number().finite(),
  })
  .strict();
export type LocalOutputLease = z.infer<typeof leaseSchema>;
type State =
  "idle" | "starting" | "sending" | "stopping" | "stopped" | "uncertain";
type Failure =
  "lease_invalid" | "start_unconfirmed" | "stop_unconfirmed" | "output_lost";

/**
 * One-shot output controller. After delivery, this instance cannot start again.
 * Lease expiry stops local sending; it does not revoke a delivered YouTube key.
 * Server reconciliation/revocation is required before issuing a new controller.
 * `sending` proves only local output, never YouTube ingest or broadcast live.
 */
export class M4LocalOutput {
  private state: State = "idle";
  private failure?: Failure;
  private lease?: LocalOutputLease;
  private revoked = false;
  private delivered = false;
  private startInFlight = false;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly port: MemoryOutputPort,
    private readonly now: () => number = Date.now,
    private readonly maximumLeaseMs = 30_000,
    private readonly operationTimeoutMs = 2_000,
  ) {
    if (
      !Number.isFinite(maximumLeaseMs) ||
      maximumLeaseMs <= 0 ||
      maximumLeaseMs > 30_000
    )
      throw new Error("lease_invalid");
    if (
      !Number.isFinite(operationTimeoutMs) ||
      operationTimeoutMs <= 0 ||
      operationTimeoutMs > 10_000
    )
      throw new Error("lease_invalid");
  }

  snapshot(): { state: State; failure?: Failure; targetDelivered: boolean } {
    return {
      state: this.state,
      ...(this.failure ? { failure: this.failure } : {}),
      targetDelivered: this.delivered,
    };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private bounded<T>(operation: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("output_unconfirmed")),
        this.operationTimeoutMs,
      );
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          reject(new Error("output_unconfirmed"));
        },
      );
    });
  }

  private validLease(value: LocalOutputLease) {
    const parsed = leaseSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.expiresAt <= this.now() ||
      parsed.data.expiresAt - this.now() > this.maximumLeaseMs
    )
      throw new Error("lease_invalid");
    return parsed.data;
  }

  private arm() {
    clearTimeout(this.timer);
    if (!this.lease || this.revoked) return;
    this.timer = setTimeout(
      () => {
        this.revoked = true;
        void this.stop().catch(() => undefined);
      },
      Math.max(0, this.lease.expiresAt - this.now()),
    );
  }

  // The caller must first authenticate a server grant. These fields alone are
  // not credentials; this class does not replace the desktop authority boundary.
  async start(lease: LocalOutputLease, target: LocalOutputTarget) {
    return this.serialize(async () => {
      if (this.state !== "idle" || this.delivered || this.revoked)
        throw new Error("start_unconfirmed");
      this.lease = this.validLease(lease);
      this.state = "starting";
      this.arm();
      this.delivered = true; // Includes ambiguous delivery/start failures.
      try {
        this.startInFlight = true;
        const starting = Promise.resolve().then(() => this.port.start(target));
        void starting.then(
          () => {
            this.startInFlight = false;
            if (this.revoked) void this.stop().catch(() => undefined);
          },
          () => {
            this.startInFlight = false;
            if (this.revoked) void this.stop().catch(() => undefined);
          },
        );
        await this.bounded(starting);
        if (this.revoked || this.lease.expiresAt <= this.now())
          throw new Error("lease_invalid");
        const observed = await this.bounded(this.port.observe());
        if (
          this.revoked ||
          this.lease.expiresAt <= this.now() ||
          observed.active !== true ||
          observed.reconnecting !== false
        )
          throw new Error("start_unconfirmed");
        this.state = "sending";
        return this.snapshot();
      } catch {
        this.failure = "start_unconfirmed";
        this.revoked = true;
        await this.stopInternal();
        throw new Error("start_unconfirmed");
      }
    });
  }

  renew(value: LocalOutputLease) {
    const lease = this.validLease(value);
    if (
      this.revoked ||
      !this.lease ||
      this.lease.expiresAt <= this.now() ||
      !["starting", "sending"].includes(this.state) ||
      lease.sessionId !== this.lease.sessionId ||
      lease.generation !== this.lease.generation ||
      lease.expiresAt < this.lease.expiresAt
    )
      throw new Error("lease_invalid");
    this.lease = lease;
    this.arm();
  }

  async check() {
    return this.serialize(async () => {
      if (this.state !== "sending") return this.snapshot();
      try {
        if (this.revoked || !this.lease || this.lease.expiresAt <= this.now())
          throw new Error("lease_invalid");
        const observation = await this.bounded(this.port.observe());
        if (
          this.revoked ||
          this.lease.expiresAt <= this.now() ||
          !observation.active ||
          observation.reconnecting
        )
          throw new Error("output_lost");
      } catch {
        this.failure = "output_lost";
        this.revoked = true;
        await this.stopInternal();
      }
      return this.snapshot();
    });
  }

  stop() {
    // Synchronously fence any start/check already in flight before queueing stop.
    this.revoked = true;
    clearTimeout(this.timer);
    return this.serialize(() => this.stopInternal());
  }

  private async stopInternal() {
    clearTimeout(this.timer);
    if (this.state === "stopped") return this.snapshot();
    if (!this.delivered) {
      this.state = "stopped";
      return this.snapshot();
    }
    this.state = "stopping";
    // Stop acknowledgment may be lost after success. Independent observation
    // can still establish inactive output. Never stop local recording here.
    try {
      await this.bounded(this.port.stop());
    } catch {
      /* Observe before deciding. */
    }
    try {
      const observed = await this.bounded(this.port.observe());
      if (
        this.startInFlight ||
        observed.active !== false ||
        observed.reconnecting !== false
      )
        throw new Error("stop_unconfirmed");
      this.state = "stopped";
      return this.snapshot();
    } catch {
      this.state = "uncertain";
      this.failure = "stop_unconfirmed";
      throw new Error("stop_unconfirmed");
    }
  }
}
