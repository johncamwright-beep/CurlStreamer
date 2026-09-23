// Node-owned private subscriptions. No browser imports or credential projection.
import { createClient } from "@supabase/supabase-js";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { M4ProgramClient } from "./m4-program-client";
import {
  cameraRoleSchema,
  signalAllowed,
  signalEnvelopeSchema,
  studioTicketSchema,
  type CameraRole,
  type StudioTicket,
} from "../m2-studio-protocol";

type Envelope = z.infer<typeof signalEnvelopeSchema>;
type SafeTicket = Omit<StudioTicket, "token" | "topic">;
export type M4RealtimeTransport = (options: {
  url: string;
  key: string;
  token: string;
  topic: string;
  receive(value: unknown): void;
  failed(): void;
}) => {
  ready: Promise<void>;
  renew(token: string): Promise<void>;
  close(): Promise<void>;
};
const fail = () => new Error("m4_program_realtime_unavailable");
async function bounded<T>(
  work: Promise<T>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        cancel = () => reject(fail());
        timer = setTimeout(cancel, milliseconds);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}

const supabaseTransport: M4RealtimeTransport = (options) => {
  const db = createClient(options.url, options.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let closed = false;
  let channel: ReturnType<typeof db.channel> | undefined;
  let cancel: (() => void) | undefined;
  const ready = (async () => {
    await db.realtime.setAuth(options.token);
    if (closed) throw fail();
    channel = db.channel(options.topic, {
      config: { private: true, broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "m2-signal" }, ({ payload }) => {
      if (!closed) options.receive(payload);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(fail()), 8000);
      cancel = () => {
        clearTimeout(timer);
        reject(fail());
      };
      channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          clearTimeout(timer);
          reject(fail());
          if (!closed) options.failed();
        }
      });
    });
  })();
  return {
    ready,
    async renew(token) {
      if (closed) throw fail();
      await db.realtime.setAuth(token);
      if (closed) throw fail();
    },
    async close() {
      if (closed) return;
      closed = true;
      cancel?.();
      try {
        if (channel) await bounded(db.removeChannel(channel), 1500);
      } finally {
        db.realtime.disconnect();
      }
    },
  };
};

/** Two isolated subscriptions; only validated envelopes and credential-free
 * ticket metadata cross the consumer boundary. The owner closes this with its
 * application lifetime. No camera Stop is dispatched by local teardown. */
export function createM4ProgramRealtime(options: {
  client: Pick<M4ProgramClient, "action" | "active">;
  url: string;
  key: string;
  transport?: M4RealtimeTransport;
}) {
  try {
    const url = new URL(options.url);
    if (
      url.protocol !== "https:" ||
      url.origin !== options.url ||
      !options.key ||
      options.key.length > 16384
    )
      throw fail();
  } catch {
    throw fail();
  }
  type Slot = {
    closed: boolean;
    ticket?: StudioTicket;
    deadline: number;
    transport?: ReturnType<M4RealtimeTransport>;
    timer?: ReturnType<typeof setInterval>;
    expiry?: ReturnType<typeof setTimeout>;
    chain: Promise<unknown>;
    pending: number;
    renewing: boolean;
    queue: Envelope[];
    seen: Map<string, number>;
    cancellation: AbortController;
  };
  let closed = false;
  const slots = new Map<CameraRole, Slot>();
  const cleanups = new Set<Promise<void>>();
  function stop(slot: Slot) {
    if (slot.closed) return;
    slot.closed = true;
    slot.cancellation.abort();
    clearInterval(slot.timer);
    clearTimeout(slot.expiry);
    slot.queue.length = 0;
    slot.seen.clear();
    slot.ticket = undefined;
    if (slot.transport) {
      const cleanup = bounded(
        Promise.resolve().then(() => slot.transport!.close()),
        2000,
      ).catch(() => undefined);
      cleanups.add(cleanup);
      void cleanup.finally(() => cleanups.delete(cleanup));
    }
  }
  function live(slot: Slot) {
    if (
      closed ||
      slot.closed ||
      !options.client.active ||
      performance.now() >= slot.deadline
    ) {
      stop(slot);
      throw fail();
    }
  }
  function setDeadline(slot: Slot, deadline: number) {
    slot.deadline = deadline;
    clearTimeout(slot.expiry);
    slot.expiry = setTimeout(
      () => stop(slot),
      Math.max(0, deadline - performance.now()),
    );
  }
  function roleValue(input: CameraRole) {
    const value = cameraRoleSchema.safeParse(input);
    if (!value.success) throw fail();
    return value.data;
  }
  function same(a: StudioTicket, b: StudioTicket) {
    return (
      a.cameraRole === b.cameraRole &&
      a.sessionId === b.sessionId &&
      a.generation === b.generation &&
      a.negotiationId === b.negotiationId &&
      a.assignmentGeneration === b.assignmentGeneration
    );
  }
  function ticket(value: unknown, role: CameraRole, start: number) {
    const row = studioTicketSchema.parse(value);
    const topic = `m2:${role}:${row.sessionId}:${row.generation}:${row.negotiationId}:receiver`;
    if (
      row.cameraRole !== role ||
      !row.negotiationId ||
      row.assignmentGeneration === null ||
      !row.token ||
      row.token.length > 16384 ||
      row.topic !== topic
    )
      throw fail();
    const deadline =
      Math.min(start + 20000, performance.now() + row.expiresAt - Date.now()) -
      1000;
    if (!Number.isFinite(deadline) || deadline <= performance.now())
      throw fail();
    return { row, deadline };
  }
  function serial<T>(slot: Slot, task: () => Promise<T>): Promise<T> {
    if (slot.pending >= 32) {
      stop(slot);
      return Promise.reject(fail());
    }
    ++slot.pending;
    const work = slot.chain.then(async () => {
      live(slot);
      return task();
    });
    slot.chain = work
      .catch(() => {
        stop(slot);
      })
      .finally(() => {
        --slot.pending;
      });
    return work.catch(() => {
      throw fail();
    });
  }
  async function check(slot: Slot) {
    live(slot);
    const current = slot.ticket!;
    const result = studioTicketSchema.parse(
      await options.client.action({
        action: "check",
        cameraRole: current.cameraRole,
        sessionId: current.sessionId,
        negotiationId: current.negotiationId!,
      }),
    );
    live(slot);
    if (!same(current, result)) throw fail();
  }
  function receive(slot: Slot, value: unknown) {
    if (closed || slot.closed || !slot.ticket) return;
    const parsed = signalEnvelopeSchema.safeParse(value);
    if (!parsed.success) return;
    const message = parsed.data,
      row = slot.ticket,
      now = Date.now();
    if (
      message.from !== "camera" ||
      !same(row, message) ||
      !signalAllowed("camera", message.signal) ||
      message.expiresAt <= now ||
      message.expiresAt > now + 15000 ||
      slot.seen.has(message.messageId)
    )
      return;
    for (const [id, expiry] of slot.seen)
      if (expiry <= now) slot.seen.delete(id);
    if (slot.seen.size >= 256) {
      stop(slot);
      return;
    }
    slot.seen.set(message.messageId, message.expiresAt);
    void serial(slot, async () => {
      await check(slot);
      if (message.expiresAt <= Date.now()) return;
      if (slot.queue.length >= 64) throw fail();
      slot.queue.push(message);
    }).catch(() => undefined);
  }
  return {
    async connect(input: CameraRole): Promise<SafeTicket> {
      const role = roleValue(input);
      if (closed || !options.client.active) throw fail();
      const previous = slots.get(role);
      if (previous) stop(previous);
      const slot: Slot = {
        closed: false,
        deadline: Infinity,
        chain: Promise.resolve(),
        pending: 0,
        renewing: false,
        queue: [],
        seen: new Map(),
        cancellation: new AbortController(),
      };
      slots.set(role, slot);
      try {
        // Keep the receiver session alive while a camera is absent. Ticket
        // issuance validates the current camera negotiation and cannot refresh
        // a receiver after that negotiation becomes stale.
        await options.client.action({ action: "check", cameraRole: role });
        live(slot);
        const start = performance.now();
        const initial = ticket(
          await options.client.action({ action: "ticket", cameraRole: role }),
          role,
          start,
        );
        live(slot);
        slot.ticket = initial.row;
        setDeadline(slot, initial.deadline);
        slot.transport = (options.transport ?? supabaseTransport)({
          url: options.url,
          key: options.key,
          token: initial.row.token!,
          topic: initial.row.topic!,
          receive: (value) => receive(slot, value),
          failed: () => stop(slot),
        });
        if (slot.closed) {
          await bounded(
            Promise.resolve().then(() => slot.transport!.close()),
            2000,
          ).catch(() => undefined);
          throw fail();
        }
        // Includes setAuth and subscription setup, and rejects immediately on
        // teardown even if the transport's underlying promise never settles.
        await bounded(slot.transport.ready, 8000, slot.cancellation.signal);
        live(slot);
        slot.timer = setInterval(() => {
          try {
            live(slot);
          } catch {
            return;
          }
          if (slot.renewing) return;
          slot.renewing = true;
          void serial(slot, async () => {
            const start = performance.now(),
              current = slot.ticket!;
            const next = ticket(
              await options.client.action({
                action: "ticket",
                cameraRole: role,
                sessionId: current.sessionId,
                negotiationId: current.negotiationId!,
              }),
              role,
              start,
            );
            live(slot);
            if (!same(current, next.row) || current.topic !== next.row.topic)
              throw fail();
            await bounded(
              slot.transport!.renew(next.row.token!),
              8000,
              slot.cancellation.signal,
            );
            live(slot);
            slot.ticket = next.row;
            setDeadline(slot, next.deadline);
          })
            .catch(() => undefined)
            .finally(() => {
              slot.renewing = false;
            });
        }, 5000);
        return studioTicketSchema
          .omit({ token: true, topic: true })
          .parse(initial.row);
      } catch {
        stop(slot);
        throw fail();
      }
    },
    async drain(input: CameraRole): Promise<Envelope[]> {
      const role = roleValue(input),
        slot = slots.get(role);
      if (!slot) throw fail();
      return serial(slot, async () => {
        await check(slot);
        return slot.queue
          .splice(0)
          .filter((message) => message.expiresAt > Date.now());
      });
    },
    async close() {
      closed = true;
      for (const slot of slots.values()) stop(slot);
      await Promise.allSettled([...cleanups]);
    },
  };
}
