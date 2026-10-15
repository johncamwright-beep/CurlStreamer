import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "@/lib/supabase/config";
import {
  signalEnvelopeSchema,
  studioTicketSchema,
  type StudioSide,
  type StudioTicket,
  type studioRequestSchema,
} from "@/lib/studio-protocol";
import { DirectPeer, type DirectMetrics } from "./direct-peer";
import type { z } from "zod";

export type StudioRequest = (
  body: z.infer<typeof studioRequestSchema>,
) => Promise<unknown>;
/** A fresh client isolates scoped Realtime credentials from account login. */
export async function connectStudio(options: {
  signal?: AbortSignal;
  side: StudioSide;
  ticket: StudioTicket;
  track?: MediaStreamTrack;
  request: StudioRequest;
  onVideo: (stream: MediaStream) => void;
  onMetrics: (metrics: DirectMetrics) => void;
  onStop: (reason: string) => void;
}) {
  const config = publicSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const db = createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let ticket = options.ticket;
  if (!ticket.token || !ticket.topic || !ticket.negotiationId)
    throw Error("Pair the phone before connecting the receiver.");
  const request = (
    action: "check" | "ticket" | "signal",
    signal?: Parameters<DirectPeer["receive"]>[0],
  ) =>
    options.request({
      action,
      side: options.side,
      sessionId: ticket.sessionId,
      negotiationId: ticket.negotiationId!,
      ...(signal ? { signal } : {}),
    });
  let closed = false;
  let channel: ReturnType<typeof db.channel> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let ready: ReturnType<typeof setInterval> | undefined;
  let cancelSubscription: (() => void) | undefined;
  let renewing = false,
    inspecting = false;
  const seen = new Set<string>();
  const peer = new DirectPeer({
    side: options.side,
    track: options.track,
    send: async (signal) => {
      if (!closed) await request("signal", signal);
    },
    onVideo: options.onVideo,
    onFailure: (reason, metrics) => {
      if (closed) return;
      // Preserve the rejected sample before stop finalizes the timed recorder.
      if (metrics) options.onMetrics(metrics);
      stop(reason);
    },
  });
  function stop(reason?: string) {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(monitor);
    clearInterval(ready);
    cancelSubscription?.();
    options.signal?.removeEventListener("abort", onAbort);
    peer.close();
    options.track?.stop();
    if (channel) void db.removeChannel(channel);
    window.removeEventListener("pagehide", onPageHide);
    if (reason) options.onStop(reason);
  }
  const onPageHide = () => stop("This page closed. Reconnect to resume.");
  const onAbort = () => stop();
  window.addEventListener("pagehide", onPageHide);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const renew = async () => {
    if (closed || renewing) return;
    renewing = true;
    try {
      const next = studioTicketSchema.parse(await request("ticket"));
      if (closed) return;
      if (
        next.sessionId !== ticket.sessionId ||
        next.negotiationId !== ticket.negotiationId ||
        next.assignmentGeneration !== ticket.assignmentGeneration ||
        next.generation !== ticket.generation ||
        !next.token
      )
        throw Error();
      await db.realtime.setAuth(next.token);
      ticket = next;
    } catch {
      stop(
        "Studio or camera authority ended. Reconnect only while the game and assignment remain active.",
      );
    } finally {
      renewing = false;
    }
  };
  try {
    if (options.signal?.aborted) throw Error("Connection cancelled.");
    await db.realtime.setAuth(ticket.token);
    if (closed) throw Error("Connection cancelled.");
    channel = db.channel(ticket.topic, {
      config: { private: true, broadcast: { self: false } },
    });
    let incoming = Promise.resolve();
    channel.on("broadcast", { event: "m1-signal" }, ({ payload }) => {
      incoming = incoming
        .then(async () => {
          const parsed = signalEnvelopeSchema.safeParse(payload);
          if (closed || !parsed.success) return;
          const message = parsed.data;
          if (
            message.from === options.side ||
            message.sessionId !== ticket.sessionId ||
            message.negotiationId !== ticket.negotiationId ||
            message.generation !== ticket.generation ||
            message.assignmentGeneration !== ticket.assignmentGeneration ||
            message.expiresAt <= Date.now() ||
            message.expiresAt > Date.now() + 15_000 ||
            seen.has(message.messageId)
          )
            return;
          seen.add(message.messageId);
          if (seen.size > 256) seen.delete(seen.values().next().value!);
          // Channel ACLs are cached; revalidate every message against current DB authority.
          await request("check");
          if (!closed && message.expiresAt > Date.now())
            await peer.receive(message.signal);
        })
        .catch(() =>
          stop(
            "Signaling authority ended. Reconnect from the current session.",
          ),
        );
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Private signaling subscription timed out.")),
        10_000,
      );
      cancelSubscription = () => {
        clearTimeout(timeout);
        reject(Error("Connection cancelled."));
      };
      channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          clearTimeout(timeout);
          reject(Error("Private signaling unavailable."));
          stop("Private signaling disconnected. Reconnect both pages.");
        }
      });
    });
    cancelSubscription = undefined;
    if (closed) throw Error("Connection ended.");
    heartbeat = setInterval(() => void renew(), 5_000);
    const startedAt = Date.now();
    let lastVerifiedAt: number | undefined;
    monitor = setInterval(() => {
      if (closed) return;
      if (Date.now() >= ticket.expiresAt) {
        stop("Studio authority expired. Capture stopped.");
        return;
      }
      if (lastVerifiedAt === undefined && Date.now() - startedAt > 45_000) {
        stop(
          "No verified direct path within 45 seconds. Reconnect both pages.",
        );
        return;
      }
      if (
        lastVerifiedAt !== undefined &&
        Date.now() - lastVerifiedAt > 10_000
      ) {
        stop(
          "Direct path statistics unavailable for 10 seconds. Connection stopped.",
        );
        return;
      }
      if (inspecting) return;
      inspecting = true;
      void peer
        .inspect()
        .then((metrics) => {
          if (metrics.direct) lastVerifiedAt = Date.now();
          if (!closed) options.onMetrics(metrics);
        })
        .catch(() => stop("Unable to verify the media path."))
        .finally(() => {
          inspecting = false;
        });
    }, 1_000);
    if (options.side === "camera") {
      const announce = () => {
        if (!closed && !peer.pc.remoteDescription)
          void request("signal", { type: "ready" }).catch(() =>
            stop("Signaling stopped. Reconnect both pages."),
          );
      };
      ready = setInterval(announce, 2_000);
      announce();
    }
    return { stop };
  } catch (cause) {
    stop();
    throw cause;
  }
}
