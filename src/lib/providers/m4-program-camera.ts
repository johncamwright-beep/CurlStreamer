import { DirectPeer, type DirectMetrics } from "./direct-peer";
import {
  signalEnvelopeSchema,
  studioTicketSchema,
  type CameraRole,
} from "../m2-studio-protocol";
import { z } from "zod";

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
  onMetrics(metrics: DirectMetrics): void;
  onStop(reason: string): void;
}) {
  const lifetime = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([lifetime.signal, options.signal])
    : lifetime.signal;
  let peer: DirectPeer | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastVerified: number | undefined,
    nextInspect = 0,
    closed = false;
  const call = (path: string, body?: unknown) =>
    options.request(
      path,
      body,
      AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    );
  function stop(reason?: string) {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    lifetime.abort();
    peer?.close();
    signal.removeEventListener("abort", onAbort);
    if (reason) options.onStop(reason);
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
      throw Error();
    peer = new DirectPeer({
      side: "receiver",
      send: async (message) => {
        if (closed) throw Error();
        await call("/camera", {
          action: "signal",
          cameraRole: options.role,
          sessionId: ticket.sessionId,
          negotiationId: ticket.negotiationId,
          signal: message,
        });
      },
      onVideo: (stream) => {
        if (!closed) options.onVideo(stream);
      },
      onFailure: (reason, metrics) => {
        if (closed) return;
        if (metrics) options.onMetrics(metrics);
        stop(reason);
      },
    });
    const started = Date.now();
    watchdog = setInterval(() => {
      if (
        lastVerified === undefined
          ? Date.now() - started > 45000
          : Date.now() - lastVerified > 10000
      )
        stop("Direct path verification timed out. Reconnect the camera.");
    }, 1000);
    async function poll() {
      if (closed) return;
      try {
        const { events } = z
          .object({ events: z.array(signalEnvelopeSchema).max(128) })
          .strict()
          .parse(await call(`/events/${options.role}`));
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
            throw Error();
          await peer!.receive(event.signal);
          if (closed) return;
        }
        if (Date.now() >= nextInspect) {
          nextInspect = Date.now() + 1000;
          const metrics = await peer!.inspect();
          if (closed) return;
          if (metrics.direct) lastVerified = Date.now();
          options.onMetrics(metrics);
          if (
            lastVerified === undefined
              ? Date.now() - started > 45000
              : Date.now() - lastVerified > 10000
          )
            throw Error();
        }
        timer = setTimeout(() => void poll(), 250);
      } catch {
        stop(
          "Camera authority or direct connection ended. Reconnect the camera.",
        );
      }
    }
    void poll();
    return { stop };
  } catch {
    stop();
    throw new Error("m4_program_camera_unavailable");
  }
}
