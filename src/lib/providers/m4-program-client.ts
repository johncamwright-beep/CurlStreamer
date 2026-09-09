// Node-owned program authority. Never import into a browser bundle.
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { BroadcastGame } from "../game-projection";
import { gameSchema } from "../schema";
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
class SlotUnavailable extends Error {}
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
// Every object projects declared fields, including nested objects. Server-only
// fields accidentally added upstream must never enter the local renderer.
const projectedGame = z.object({
  id: z.uuid(),
  config: gameSchema.pick({
    eventName: true,
    homeName: true,
    awayName: true,
    homeColor: true,
    awayColor: true,
  }),
  score: z.object({
    hammer: z.enum(["home", "away"]).nullable(),
    totals: z.object({
      home: z.number().int().nonnegative(),
      away: z.number().int().nonnegative(),
    }),
    currentEnd: z.number().int().positive(),
  }),
  layout: z.enum(["split", "home", "away"]),
  broadcast: z.enum(["idle", "live"]),
  audioMuted: z.boolean(),
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
  constructor(gameId: string, origin: string, fetcher: typeof fetch = fetch) {
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
  }
  get active() {
    return this.#state === "active" && performance.now() < this.#deadline;
  }
  close() {
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
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new NetworkUnavailable();
      }
      if (
        method === "POST" &&
        cookie &&
        response.status === 409 &&
        !response.redirected
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new SlotUnavailable();
      }
      if (!response.ok || response.status !== 200 || response.redirected)
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
        return {
          headers: response.headers,
          value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        };
      } finally {
        await reader.cancel().catch(() => undefined);
        for (const chunk of chunks) chunk.fill(0);
      }
    } catch (cause) {
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
      throw fail();
    }
  }
  /** Reads only this invitation's game. Signed sponsor render URLs remain
   * scoped media capabilities; callers must not persist them or log responses. */
  async readGame(): Promise<BroadcastGame> {
    if (!this.active || !this.#cookie) {
      this.close();
      throw fail();
    }
    try {
      const { value } = await this.#call(undefined, this.#cookie, "GET");
      if (!this.active) throw fail();
      const { game, organizationId } = z
        .object({ game: projectedGame, organizationId: z.uuid().optional() })
        .parse(value);
      if (game.id !== this.#gameId) throw fail();
      this.#organizationId = organizationId;
      return { ...game, cameraFraming: game.cameraFraming };
    } catch (cause) {
      // GET checks the entire program scope; a failure differs from a waiting slot.
      // A transport outage does not revoke the credential. Subsequent requests
      // still validate the game and the original, unextended deadline.
      if (!(cause instanceof NetworkUnavailable)) this.close();
      throw fail();
    }
  }
}
