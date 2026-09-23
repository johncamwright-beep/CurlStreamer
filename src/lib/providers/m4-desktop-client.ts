// Native Node entry points only; node:crypto intentionally prevents browser use.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const session = z.object({
  sessionId: z.uuid(),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.iso.datetime({ offset: true }),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
});
const exchangeResponse = session.extend({ bearer: secret });
const actionResponse = session.extend({
  desiredAction: z.enum(["wait", "stop"]),
});
const handoffResponse = session
  .extend({
    intentId: z.uuid(),
    target: z
      .object({
        serverUrl: z.literal("rtmps://a.rtmps.youtube.com:443/live2"),
        streamKey: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
      })
      .strict(),
  })
  .strict();
const observationResponse = z
  .object({
    intentId: z.uuid(),
    sessionId: z.uuid(),
    generation: z.number().int().positive(),
    streamStatus: z.enum([
      "active",
      "created",
      "ready",
      "inactive",
      "error",
      "missing",
    ]),
    healthStatus: z.enum(["good", "ok", "bad", "noData"]).nullable(),
    broadcastStatus: z.enum([
      "complete",
      "created",
      "live",
      "ready",
      "revoked",
      "testStarting",
      "testing",
      "liveStarting",
    ]),
    broadcastLive: z.boolean(),
  })
  .strict();
export type M4ProviderObservation = Pick<
  z.infer<typeof observationResponse>,
  "streamStatus" | "healthStatus" | "broadcastStatus" | "broadcastLive"
>;
type State =
  | "unpaired"
  | "exchanging"
  | "active"
  | "failed"
  | "expired"
  | "stopping"
  | "stopped";
const fail = () => new Error("m4_desktop_client_unavailable");

/** Node-only capability holder. It does not control OBS. A native watchdog must
 * poll snapshot and stop OBS whenever authority is not active, including stalls.
 * Credentials never leave private memory except in the designated HTTPS request.
 */
export class M4DesktopClient {
  #verifier: string | undefined = randomBytes(32).toString("base64url");
  #challenge = createHash("sha256").update(this.#verifier!).digest("hex");
  #bearer: string | undefined;
  #session: z.infer<typeof session> | undefined;
  #state: State = "unpaired";
  #lease = 0;
  #absolute = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #fence = 0;
  #handoffAttempted = false;
  #activeIntent?: string;
  #base: string;
  #fetcher: typeof fetch;
  #clock: () => number;

  constructor(
    gameId: string,
    origin: string,
    options: { fetcher?: typeof fetch; clock?: () => number } = {},
  ) {
    try {
      z.uuid().parse(gameId);
      const url = new URL(origin);
      if (
        url.protocol !== "https:" ||
        url.origin !== origin ||
        url.username ||
        url.password
      )
        throw fail();
      this.#base = `${origin}/api/games/${gameId}/studio-m4/desktop`;
    } catch {
      throw fail();
    }
    this.#fetcher = options.fetcher ?? fetch;
    this.#clock = options.clock ?? (() => performance.now());
  }
  get challenge() {
    return this.#challenge;
  }
  snapshot() {
    this.#expire();
    return { state: this.#state, authorized: this.#state === "active" };
  }
  /** Non-secret authority duration, including a native stop margin. */
  remainingLeaseMs() {
    this.#expire();
    return this.#state === "active"
      ? Math.max(
          0,
          Math.floor(
            // Cover the pipe's 2-second reply bound plus stop scheduling margin.
            Math.min(this.#lease, this.#absolute) - this.#clock() - 3000,
          ),
        )
      : 0;
  }
  /** Target never becomes a public return value or snapshot. A lost handoff is
   * terminal, including when the local sink reports an uncertain write. */
  handoffOutput(
    intentId: string,
    receive: (
      target: z.infer<typeof handoffResponse>["target"],
      remainingLeaseMs: number,
    ) => Promise<void>,
  ) {
    if (this.#handoffAttempted || !z.uuid().safeParse(intentId).success)
      return Promise.reject(fail());
    this.#handoffAttempted = true;
    const fence = this.#fence;
    return this.#serialize(async () => {
      try {
        this.#expire();
        if (
          this.#state !== "active" ||
          !this.#session ||
          !this.#bearer ||
          fence !== this.#fence
        )
          throw fail();
        const request = {
          intentId,
          sessionId: this.#session.sessionId,
          generation: this.#session.generation,
        };
        const reservation = await this.#request(
          "/output-intent",
          request,
          this.#bearer,
        );
        const reserved = z
          .object({
            intentId: z.literal(intentId),
            sessionId: z.literal(this.#session.sessionId),
            generation: z.literal(this.#session.generation),
            phase: z.literal("reserved"),
            deliveryRecorded: z.literal(false),
          })
          .strict()
          .safeParse(reservation.value);
        this.#expire();
        if (
          !reserved.success ||
          this.#state !== "active" ||
          fence !== this.#fence
        )
          throw fail();
        const response = await this.#request("/target", request, this.#bearer);
        const target = handoffResponse.parse(response.value);
        this.#expire();
        if (
          this.#state !== "active" ||
          fence !== this.#fence ||
          target.intentId !== intentId ||
          target.sessionId !== this.#session.sessionId ||
          target.generation !== this.#session.generation ||
          target.expiresAt !== this.#session.expiresAt
        )
          throw fail();
        this.#lease = Math.min(
          this.#lease,
          this.#deadlines(target, response.date, response.start).lease,
        );
        const remaining = this.remainingLeaseMs();
        if (remaining < 1) throw fail();
        await receive(target.target, remaining);
        this.#expire();
        if (this.#state !== "active" || fence !== this.#fence) throw fail();
        this.#activeIntent = intentId;
        return this.snapshot();
      } catch {
        if (this.#state === "active") this.#state = "failed";
        throw fail();
      }
    });
  }
  /** Read-only independent provider evidence. Never extends a desktop/native
   * lease or retries a consumed destination. Observation outages stay unknown. */
  observeOutput(intentId: string): Promise<M4ProviderObservation> {
    const fence = this.#fence;
    return this.#serialize(async () => {
      this.#expire();
      if (
        this.#state !== "active" ||
        !this.#session ||
        !this.#bearer ||
        this.#activeIntent !== intentId ||
        fence !== this.#fence
      )
        throw fail();
      try {
        const response = await this.#request(
          "/observe",
          {
            intentId,
            sessionId: this.#session.sessionId,
            generation: this.#session.generation,
          },
          this.#bearer,
        );
        const result = observationResponse.parse(response.value);
        this.#expire();
        if (
          this.#state !== "active" ||
          fence !== this.#fence ||
          result.intentId !== intentId ||
          result.sessionId !== this.#session.sessionId ||
          result.generation !== this.#session.generation ||
          result.broadcastLive !== (result.broadcastStatus === "live")
        )
          throw fail();
        return {
          streamStatus: result.streamStatus,
          healthStatus: result.healthStatus,
          broadcastStatus: result.broadcastStatus,
          broadcastLive: result.broadcastLive,
        };
      } catch {
        throw fail();
      }
    });
  }
  #expire() {
    const now = this.#clock();
    if (this.#session && now >= this.#absolute) {
      this.#bearer = undefined;
      if (this.#state !== "stopped") this.#state = "expired";
    } else if (this.#state === "active" && now >= this.#lease)
      this.#state = "expired";
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }
  async #request(path: string, body: unknown, bearer?: string) {
    const start = this.#clock();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.#fetcher(this.#base + path, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          headers: {
            "content-type": "application/json",
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw fail();
          return {
            value: await response.json(),
            date: Date.parse(response.headers.get("date") ?? ""),
          };
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(fail());
          }, 5_000);
        }),
      ]);
      if (!Number.isFinite(response.date)) throw fail();
      return { ...response, start };
    } catch {
      throw fail();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  #deadlines(row: z.infer<typeof session>, date: number, start: number) {
    // HTTP Date has second precision. Anchor at request start so network time
    // consumes authority, rather than granting a fresh lease after a slow reply.
    const absolute =
      start +
      Math.min(4 * 60 * 60_000, Date.parse(row.expiresAt) - date) -
      1_000;
    const lease = Math.min(
      absolute,
      start + Math.min(30_000, Date.parse(row.leaseExpiresAt) - date) - 1_000,
    );
    return { absolute, lease };
  }
  exchange(code: string) {
    if (this.#state !== "unpaired") return Promise.reject(fail());
    this.#state = "exchanging";
    const fence = this.#fence;
    return this.#serialize(async () => {
      try {
        if (!secret.safeParse(code).success || !this.#verifier) throw fail();
        const response = await this.#request("/exchange", {
          code,
          verifier: this.#verifier,
        });
        const parsed = exchangeResponse.safeParse(response.value);
        if (!parsed.success) throw fail();
        const deadlines = this.#deadlines(
          parsed.data,
          response.date,
          response.start,
        );
        this.#session = session.parse(parsed.data);
        this.#bearer = parsed.data.bearer;
        this.#absolute = deadlines.absolute;
        this.#lease = deadlines.lease;
        if (fence === this.#fence) this.#state = "active";
        this.#expire();
        if (this.#state !== "active") throw fail();
        return this.snapshot();
      } catch {
        if (fence === this.#fence && this.#state !== "expired")
          this.#state = "failed";
        throw fail();
      } finally {
        this.#verifier = undefined;
      }
    });
  }
  heartbeat() {
    const fence = this.#fence;
    return this.#serialize(async () => {
      try {
        this.#expire();
        if (
          this.#state !== "active" ||
          !this.#session ||
          !this.#bearer ||
          fence !== this.#fence
        )
          throw fail();
        const response = await this.#request(
          "",
          {
            action: "heartbeat",
            sessionId: this.#session.sessionId,
            generation: this.#session.generation,
          },
          this.#bearer,
        );
        const parsed = actionResponse.safeParse(response.value);
        if (
          !parsed.success ||
          parsed.data.sessionId !== this.#session.sessionId ||
          parsed.data.generation !== this.#session.generation ||
          parsed.data.expiresAt !== this.#session.expiresAt
        )
          throw fail();
        this.#expire();
        if (this.#state !== "active" || fence !== this.#fence) throw fail();
        if (parsed.data.desiredAction === "stop") this.#state = "stopping";
        else
          this.#lease = Math.min(
            this.#absolute,
            this.#deadlines(parsed.data, response.date, response.start).lease,
          );
        this.#expire();
        return { ...this.snapshot(), desiredAction: parsed.data.desiredAction };
      } catch {
        if (this.#state === "active") this.#state = "failed";
        throw fail();
      }
    });
  }
  stop() {
    ++this.#fence;
    if (this.#state !== "stopped") this.#state = "stopping";
    return this.#serialize(async () => {
      this.#expire();
      if (this.#state === "stopped") return this.snapshot();
      if (!this.#session || !this.#bearer || this.#clock() >= this.#absolute)
        throw fail();
      try {
        const response = await this.#request(
          "",
          {
            action: "stop",
            sessionId: this.#session.sessionId,
            generation: this.#session.generation,
          },
          this.#bearer,
        );
        const parsed = actionResponse.safeParse(response.value);
        if (
          !parsed.success ||
          parsed.data.desiredAction !== "stop" ||
          parsed.data.sessionId !== this.#session.sessionId ||
          parsed.data.generation !== this.#session.generation
        )
          throw fail();
        this.#state = "stopped";
        this.#bearer = undefined;
        return this.snapshot();
      } catch {
        throw fail();
      }
    });
  }
}
