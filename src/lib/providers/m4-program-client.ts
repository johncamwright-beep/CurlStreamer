// Node-owned program authority. Never import into a browser bundle.
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { PrivateProgramGame } from "../game-projection";
import { gameSchema } from "../schema";
import { StudioTransportUnavailable } from "./studio-transport-error";
import type {
  ConnectionDiagnostic,
  ConnectionDiagnosticInput,
} from "./connection-diagnostics";
import {
  cameraRoleSchema,
  signalAllowed,
  signalSchema,
  studioTicketSchema,
} from "../m2-studio-protocol";

const actionSchema = z
  .object({
    action: z.enum(["check", "ticket", "signal", "stop"]),
    cameraRole: cameraRoleSchema,
    sessionId: z.uuid().optional(),
    negotiationId: z.uuid().optional(),
    signal: signalSchema.optional(),
  })
  .strict();
const fail = () => new Error("m4_program_unavailable");
class SlotUnavailable extends Error {
  constructor(
    readonly reason: ConnectionDiagnosticInput["code"] = "authority_rejected",
  ) {
    super();
  }
}
class NetworkUnavailable extends Error {}

const sponsorUrl = z
  .string()
  .max(8192)
  .refine((value) => {
    if (value === "/sponsors/community.svg" || value === "/sponsors/rock.svg")
      return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });
function validTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
// Every object projects declared fields, including nested objects. Server-only
// fields accidentally added upstream must never enter the local renderer.
const projectedGame = z.object({
  id: z.uuid(),
  broadcastSchedule: z
    .object({
      scheduledStart: z.string().datetime({ offset: true }),
      timezone: z.string().min(1).max(100).refine(validTimezone),
    })
    .optional(),
  config: z.object({
    eventName: gameSchema.shape.eventName,
    homeName: gameSchema.shape.homeName,
    awayName: gameSchema.shape.awayName,
    homeColor: gameSchema.shape.homeColor,
    awayColor: gameSchema.shape.awayColor,
  }),
  score: z.object({
    hammer: z.enum(["home", "away"]).nullable(),
    totals: z.object({
      home: z.number().int().nonnegative(),
      away: z.number().int().nonnegative(),
    }),
    currentEnd: z.number().int().positive(),
  }),
  layout: z.enum(["split", "home", "away", "none"]),
  broadcast: z.enum(["idle", "live"]),
  audioMuted: z.boolean(),
  cameraAudio: z
    .object({
      "camera-home": z
        .object({
          enabled: z.boolean(),
          volume: z.number().min(0).max(1).optional(),
        })
        .optional(),
      "camera-away": z
        .object({
          enabled: z.boolean(),
          volume: z.number().min(0).max(1).optional(),
        })
        .optional(),
    })
    .optional(),
  cameraFraming: z
    .object({
      "camera-home": z.enum(["fill", "contain"]).optional(),
      "camera-away": z.enum(["fill", "contain"]).optional(),
    })
    .optional(),
  sponsors: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().max(100),
        altText: z.string().max(1000).optional(),
        dataUrl: sponsorUrl,
        enabled: z.boolean(),
        rotation: z.number().int(),
      }),
    )
    .max(100),
  sponsorMode: z.object({
    active: z.boolean(),
    style: z.enum(["fullscreen", "overlay"]),
    intervalSeconds: z.number().int().min(3).max(10),
    startedAt: z.number().nonnegative().nullable(),
    rotationOffset: z.number().int(),
    paused: z.boolean(),
  }),
});

/** Exchanges one existing M3 invitation. Does not prepare/reassign cameras.
 * Cookie authority never leaves this object. No arbitrary URL/header forwarding.
 * Future loopback renderer must still authenticate its local callers and keep
 * scoped realtime tickets out of persistent browser storage/logs.
 */
export class M4ProgramClient {
  #endpoint: string;
  #origin: string;
  #gameId: string;
  #cookie?: string;
  #organizationId?: string;
  #deadline = 0;
  #state: "new" | "exchanging" | "active" | "closed" = "new";
  #requests = new Set<AbortController>();
  #fetch: typeof fetch;
  #diagnostic?: ConnectionDiagnostic;
  #failed = new Set<string>();
  constructor(
    gameId: string,
    origin: string,
    fetcher: typeof fetch = fetch,
    diagnostic?: ConnectionDiagnostic,
  ) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw fail();
    }
    if (
      !z.uuid().safeParse(gameId).success ||
      url.protocol !== "https:" ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw fail();
    this.#origin = origin;
    this.#gameId = gameId;
    this.#endpoint = `${origin}/api/games/${gameId}/studio-m3`;
    this.#fetch = fetcher;
    this.#diagnostic = diagnostic;
  }
  #log(input: ConnectionDiagnosticInput) {
    try {
      this.#diagnostic?.(input);
    } catch {
      /* No effect on authority or media. */
    }
  }
  get active() {
    return this.#state === "active" && performance.now() < this.#deadline;
  }
  close() {
    if (this.#state !== "closed")
      this.#log({ layer: "session", code: "stopped" });
    this.#state = "closed";
    this.#cookie = undefined;
    this.#organizationId = undefined;
    this.#deadline = 0;
    for (const controller of this.#requests) controller.abort();
  }
  /** Node-only sponsor scope metadata. Never include it in renderer data. */
  sponsorOrganizationId() {
    return this.#organizationId;
  }
  async #call(body: unknown, cookie?: string, method: "GET" | "POST" = "POST") {
    try {
      return await this.#attempt(body, cookie, method);
    } catch (cause) {
      const action = (body as { action?: string } | undefined)?.action;
      // Only idempotent reads/lease checks may be retried. Never replay an
      // invitation exchange, signal or stop after an ambiguous response.
      if (
        !(cause instanceof NetworkUnavailable) ||
        !this.active ||
        !(method === "GET" || action === "check" || action === "ticket")
      )
        throw cause;
      return this.#attempt(body, cookie, method);
    }
  }
  async #attempt(
    body: unknown,
    cookie?: string,
    method: "GET" | "POST" = "POST",
  ) {
    const started = performance.now();
    const metadata = body as
      | {
          action?: ConnectionDiagnosticInput["action"];
          cameraRole?: "camera-home" | "camera-away";
        }
      | undefined;
    const action = method === "GET" ? "read" : metadata?.action;
    const role = metadata?.cameraRole;
    const scope = `${role ?? "program"}:${action}`;
    let status: number | undefined;
    let trace: string | undefined;
    const controller = new AbortController();
    this.#requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          origin: this.#origin,
          ...(cookie ? { cookie } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }).catch(() => {
        throw new NetworkUnavailable();
      });
      status = response.status;
      const correlation = response.headers.get("x-curlstreamer-trace");
      if (correlation && z.uuid().safeParse(correlation).success)
        trace = correlation;
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new NetworkUnavailable();
      }
      const slotConflict =
        method === "POST" &&
        cookie &&
        response.status === 409 &&
        !response.redirected;
      if (
        !slotConflict &&
        (!response.ok || response.status !== 200 || response.redirected)
      )
        throw fail();
      const reader = response.body?.getReader();
      if (!reader) throw fail();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 65536) throw fail();
          chunks.push(value);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        if (slotConflict) {
          let value: { code?: unknown } | null = null;
          try {
            value = JSON.parse(text);
          } catch {
            /* An unlabelled conflict still affects only this slot. */
          }
          const reason = [
            "studio_stale",
            "peer_stale",
            "camera_released",
            "signal_limit",
          ].includes(value?.code as string)
            ? (value?.code as ConnectionDiagnosticInput["code"])
            : "authority_rejected";
          throw new SlotUnavailable(reason);
        }
        const durationMs = Math.min(
          600_000,
          Math.round(performance.now() - started),
        );
        if (this.#failed.delete(scope) || durationMs >= 1500)
          this.#log({
            layer: "http",
            code: durationMs >= 1500 ? "slow" : "recovered",
            action,
            role,
            status,
            trace,
            durationMs,
          });
        return {
          headers: response.headers,
          value: JSON.parse(text) as unknown,
        };
      } finally {
        await reader.cancel().catch(() => undefined);
        for (const chunk of chunks) chunk.fill(0);
      }
    } catch (cause) {
      if (
        controller.signal.aborted &&
        this.active &&
        !(cause instanceof SlotUnavailable)
      )
        cause = new NetworkUnavailable();
      this.#failed.add(scope);
      this.#log({
        layer: "http",
        code:
          cause instanceof NetworkUnavailable
            ? controller.signal.aborted
              ? "timeout"
              : "network_unavailable"
            : cause instanceof SlotUnavailable
              ? cause.reason
              : "authority_rejected",
        action,
        role,
        status,
        trace,
        durationMs: Math.min(600_000, Math.round(performance.now() - started)),
      });
      if (
        cause instanceof SlotUnavailable ||
        cause instanceof NetworkUnavailable
      )
        throw cause;
      throw fail();
    } finally {
      clearTimeout(timer);
      this.#requests.delete(controller);
    }
  }
  async exchange(code: string) {
    if (this.#state !== "new" || !/^[A-Za-z0-9_-]{43}$/.test(code))
      throw fail();
    this.#state = "exchanging";
    const start = performance.now();
    try {
      const { headers, value } = await this.#call({ action: "exchange", code });
      const serverDate = Date.parse(headers.get("date") ?? "");
      if (
        !Number.isFinite(serverDate) ||
        Math.abs(Date.now() - serverDate) > 30000
      )
        throw fail();
      z.object({ ok: z.literal(true) })
        .strict()
        .parse(value);
      const cookies = headers.getSetCookie();
      if (cookies.length !== 1) throw fail();
      const parts = cookies[0].split(";").map((part) => part.trim());
      if (
        !/^curlcast_m3_program=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
          parts[0],
        )
      )
        throw fail();
      const attrs = new Map<string, string>();
      for (const part of parts.slice(1)) {
        const index = part.indexOf("=");
        const name = (index < 0 ? part : part.slice(0, index)).toLowerCase();
        if (attrs.has(name)) throw fail();
        attrs.set(name, index < 0 ? "" : part.slice(index + 1));
      }
      const age = Number(attrs.get("max-age"));
      if (
        !Number.isInteger(age) ||
        age <= 0 ||
        age > 14400 ||
        !attrs.has("httponly") ||
        !attrs.has("secure") ||
        attrs.get("samesite")?.toLowerCase() !== "strict" ||
        attrs.has("domain") ||
        attrs.get("path") !== new URL(this.#endpoint).pathname
      )
        throw fail();
      if (this.#state !== "exchanging") throw fail();
      this.#deadline =
        start + age * 1000 - Math.abs(Date.now() - serverDate) - 1000;
      if (performance.now() >= this.#deadline) throw fail();
      this.#cookie = parts[0];
      this.#state = "active";
    } catch {
      this.close();
      throw fail();
    }
  }
  async action(input: z.input<typeof actionSchema>) {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) throw fail();
    const body = parsed.data;
    if (!this.active || !this.#cookie) {
      this.close();
      throw fail();
    }
    if (
      body.action === "signal" &&
      (!body.signal ||
        !body.negotiationId ||
        !signalAllowed("receiver", body.signal))
    )
      throw fail();
    try {
      const { value } = await this.#call(body, this.#cookie);
      if (!this.active) throw fail();
      if (body.action === "signal")
        return z
          .object({ ok: z.literal(true) })
          .strict()
          .parse(value);
      const ticket = (
        body.action === "ticket"
          ? studioTicketSchema
          : studioTicketSchema.omit({ token: true, topic: true })
      ).parse(value);
      if (
        ticket.cameraRole !== body.cameraRole ||
        (body.sessionId && ticket.sessionId !== body.sessionId)
      )
        throw fail();
      return ticket;
    } catch (cause) {
      if (
        !(cause instanceof SlotUnavailable) &&
        !(cause instanceof NetworkUnavailable)
      )
        this.close();
      if (cause instanceof NetworkUnavailable)
        throw new StudioTransportUnavailable();
      throw fail();
    }
  }
  /** Reads only this invitation's game. Signed sponsor render URLs remain
   * scoped media capabilities; callers must not persist them or log responses. */
  async readGame(): Promise<PrivateProgramGame> {
    if (!this.active || !this.#cookie) {
      this.close();
      throw fail();
    }
    try {
      const { value } = await this.#call(undefined, this.#cookie, "GET");
      if (!this.active) throw fail();
      const { game, organizationId } = z
        .object({
          game: projectedGame.extend({
            nativeCameraAudio: projectedGame.shape.cameraAudio,
          }),
          organizationId: z.uuid().optional(),
        })
        .parse(value);
      if (game.id !== this.#gameId) throw fail();
      this.#organizationId = organizationId;
      return { ...game, cameraFraming: game.cameraFraming };
    } catch (cause) {
      // GET checks the entire program scope; a failure differs from a waiting slot.
      // A transport outage does not revoke the credential. Subsequent requests
      // still validate the game and the original, unextended deadline.
      if (!(cause instanceof NetworkUnavailable)) this.close();
      if (cause instanceof NetworkUnavailable)
        throw new StudioTransportUnavailable();
      throw fail();
    }
  }
}
