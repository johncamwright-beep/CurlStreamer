import { DirectPeer, type DirectMetrics } from "./direct-peer";
import {
  signalEnvelopeSchema,
  studioTicketSchema,
  type CameraRole,
} from "../m2-studio-protocol";
import { z } from "zod";
import { StudioTransportUnavailable } from "./studio-transport-error";
import { ConnectionFailure } from "./camera-connection-coordinator";

const temporary = (cause: unknown) =>
  cause instanceof StudioTransportUnavailable ||
  (cause instanceof ConnectionFailure && cause.retryable);
const failureFor = (cause: unknown) =>
  cause instanceof ConnectionFailure
    ? cause
    : new ConnectionFailure("transport_failed", true);

/** Renderer transport only. Uses the existing unchanged direct-path verifier.
 * The trusted application supplies the local API transport; no Supabase client,
 * invitation, cookie or realtime token is accepted by this module.
 */
export async function connectM4ProgramCamera(options: {
  role: CameraRole;
  request(
    path: string,
    body: unknown | undefined,
    signal: AbortSignal,
  ): Promise<unknown>;
  signal?: AbortSignal;
  onVideo(stream: MediaStream): void;
  onAudio?(stream: MediaStream): void;
  onMetrics(metrics: DirectMetrics): void;
  onStop(reason: string, failure?: ConnectionFailure): void;
}) {
  const lifetime = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([lifetime.signal, options.signal])
    : lifetime.signal;
  let peer: DirectPeer | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastVerified: number | undefined,
    inspecting = false,
    closed = false;
  const call = async (path: string, body?: unknown) => {
    if (closed || signal.aborted) throw new ConnectionFailure("stopped", false);
    // Event polling runs once per second. AbortSignal.timeout() leaves
    // each successful request's timer alive until its deadline, so clear the
    // deadline as soon as this request settles or the connection stops.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 8000);
    const cancel = () => {
      clearTimeout(timer);
      deadline.abort();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const value = await options.request(
        path,
        body,
        AbortSignal.any([signal, deadline.signal]),
      );
      if (closed || signal.aborted)
        throw new ConnectionFailure("stopped", false);
      return value;
    } catch (cause) {
      // A local read can time out while Node is still retrying its upstream
      // authority check. Do not turn that transport delay into peer teardown.
      // Rejected authority/metadata and ambiguous signaling writes still stop.
      if (
        (path.startsWith("/events/") ||
          (path === "/camera" &&
            (body as { signal?: { type?: string } } | undefined)?.signal
              ?.type === "path-confirmed")) &&
        !signal.aborted &&
        (deadline.signal.aborted || cause instanceof TypeError)
      )
        throw new StudioTransportUnavailable();
      throw cause;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    }
  };
  function stop(reason?: string, failure?: ConnectionFailure) {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    lifetime.abort();
    peer?.close();
    signal.removeEventListener("abort", onAbort);
    if (reason) options.onStop(reason, failure);
  }
  const onAbort = () => stop();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) throw Error();
    const ticket = studioTicketSchema
      .omit({ token: true, topic: true })
      .strict()
      .parse(
        await call("/camera", { action: "connect", cameraRole: options.role }),
      );
    if (
      signal.aborted ||
      ticket.cameraRole !== options.role ||
      !ticket.negotiationId ||
      ticket.assignmentGeneration === null
    )
      throw new ConnectionFailure("authority_rejected", false);
    peer = new DirectPeer({
      side: "receiver",
      send: async (message) => {
        if (closed) throw Error();
        try {
          await call("/camera", {
            action: "signal",
            cameraRole: options.role,
            sessionId: ticket.sessionId,
            negotiationId: ticket.negotiationId,
            signal: message,
          });
        } catch (cause) {
          if (cause instanceof ConnectionFailure && !cause.retryable)
            stop(
              "Camera authority ended. Reconnect only while the game remains active.",
              cause,
            );
          throw cause;
        }
      },
      onVideo: (stream) => {
        if (!closed) options.onVideo(stream);
      },
      onAudio: (stream) => {
        if (!closed) options.onAudio?.(stream);
      },
      onFailure: (reason, metrics) => {
        if (closed) return;
        if (metrics) options.onMetrics(metrics);
        stop(
          "Direct camera connection ended. Reconnect the camera.",
          new ConnectionFailure("verification_failed", true),
        );
      },
      onConfirmationFailure: (cause) => {
        // A missed proof is not retried. A subsequent verified measurement
        // may send a fresh proof while the relay's ticket is still valid.
        if (closed || temporary(cause)) return;
        stop(
          "Camera authority or direct connection ended. Reconnect the camera.",
          failureFor(cause),
        );
      },
    });
    const started = Date.now();
    const eventScope = new URLSearchParams({
      sessionId: ticket.sessionId,
      negotiationId: ticket.negotiationId,
      generation: String(ticket.generation),
      assignmentGeneration: String(ticket.assignmentGeneration),
    });
    async function inspect() {
      if (closed || inspecting) return;
      inspecting = true;
      try {
        const metrics = await peer!.inspect();
        if (closed) return;
        if (metrics.direct) lastVerified = Date.now();
        options.onMetrics(metrics);
      } catch {
        stop(
          "Direct camera verification failed. Reconnect the camera.",
          new ConnectionFailure("verification_failed", true),
        );
      } finally {
        inspecting = false;
      }
    }
    watchdog = setInterval(() => {
      if (closed) return;
      if (
        lastVerified === undefined
          ? Date.now() - started > 45000
          : Date.now() - lastVerified > 10000
      )
        stop(
          "Direct path verification timed out. Reconnect the camera.",
          new ConnectionFailure("verification_timeout", true),
        );
      else void inspect();
    }, 1000);
    // Local WebRTC evidence is independent of internet signaling latency.
    void inspect();
    async function poll() {
      if (closed) return;
      try {
        const { events } = z
          .object({ events: z.array(signalEnvelopeSchema).max(128) })
          .strict()
          .parse(await call(`/events/${options.role}?${eventScope}`));
        if (closed) return;
        for (const event of events) {
          if (
            event.cameraRole !== options.role ||
            event.from !== "camera" ||
            event.sessionId !== ticket.sessionId ||
            event.negotiationId !== ticket.negotiationId ||
            event.generation !== ticket.generation ||
            event.assignmentGeneration !== ticket.assignmentGeneration ||
            event.expiresAt <= Date.now() ||
            event.expiresAt > Date.now() + 15000
          )
            throw new ConnectionFailure("authority_rejected", false);
          await peer!.receive(event.signal);
          if (closed) return;
        }
        // Drain once a second. The relay validates authority through five-second
        // ticket renewals and freshly checks every queued signaling message.
        timer = setTimeout(() => void poll(), 1000);
      } catch (cause) {
        // The Node relay retains only its unexpired ticket, and direct-path
        // verification remains independently bounded by the watchdog.
        if (closed) return;
        if (temporary(cause)) {
          timer = setTimeout(() => void poll(), 1000);
          return;
        }
        stop(
          "Camera authority or direct connection ended. Reconnect the camera.",
          failureFor(cause),
        );
      }
    }
    void poll();
    return { stop };
  } catch (cause) {
    stop();
    if (
      cause instanceof ConnectionFailure ||
      cause instanceof StudioTransportUnavailable
    )
      throw cause;
    throw new Error("m4_program_camera_unavailable");
  }
}
