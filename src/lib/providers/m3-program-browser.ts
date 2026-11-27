import type { BroadcastGame } from "@/lib/game-projection";
import { studioTicketSchema, type CameraRole } from "@/lib/m2-studio-protocol";
import { connectStudio, type StudioRequest } from "./m2-studio-browser";
import type { DirectMetrics } from "./direct-peer";

export const programRoles: CameraRole[] = ["camera-home", "camera-away"];
export type ProgramCamera = {
  stream?: MediaStream;
  metrics?: DirectMetrics;
  status: string;
};

/** Connections outlive layout changes; no media or credentials cross browser tabs. */
export function startProgramReceiver(options: {
  gameId: string;
  onGame: (game: BroadcastGame) => void;
  onCamera: (role: CameraRole, value: ProgramCamera) => void;
  onError: (message: string) => void;
}) {
  const endpoint = `/api/games/${options.gameId}/studio-m3`;
  let closed = false,
    polling = false;
  const slots = new Map<
    CameraRole,
    {
      handle?: { stop(): void };
      abort?: AbortController;
      negotiation?: string;
      failedNegotiation?: string;
      busy: boolean;
      epoch: number;
      value: ProgramCamera;
    }
  >(
    programRoles.map((role) => [
      role,
      { busy: false, epoch: 0, value: { status: "Waiting for camera" } },
    ]),
  );
  const controllers = new Set<AbortController>();
  async function call(body?: unknown) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(endpoint, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
        signal: controller.signal,
      });
      if (!response.ok) throw Error("Program authority unavailable");
      return await response.json();
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  function clearSlot(role: CameraRole, status: string) {
    const slot = slots.get(role)!;
    slot.epoch++;
    slot.abort?.abort();
    slot.abort = undefined;
    slot.handle?.stop();
    slot.handle = undefined;
    slot.value.stream?.getTracks().forEach((track) => track.stop());
    slot.value = { status };
    slot.busy = false;
    options.onCamera(role, slot.value);
  }
  async function updateSlot(role: CameraRole) {
    const slot = slots.get(role)!;
    if (closed || slot.busy) return;
    slot.busy = true;
    let attempt = slot.epoch;
    try {
      // This also renews the slot's receiver heartbeat while waiting for pairing.
      await call({ action: "check", cameraRole: role });
      const ticket = studioTicketSchema.parse(
        await call({ action: "ticket", cameraRole: role }),
      );
      if (closed || slot.epoch !== attempt) return;
      if (ticket.cameraRole !== role || !ticket.negotiationId) throw Error();
      if (
        (slot.handle && slot.negotiation === ticket.negotiationId) ||
        slot.failedNegotiation === ticket.negotiationId
      )
        return;
      clearSlot(role, "Connecting camera");
      attempt = slot.epoch;
      slot.busy = true;
      slot.negotiation = ticket.negotiationId;
      const current = slot.epoch;
      slot.abort = new AbortController();
      const request: StudioRequest = (body) =>
        call({
          action: body.action,
          cameraRole: role,
          sessionId: body.sessionId,
          negotiationId: body.negotiationId,
          ...(body.signal ? { signal: body.signal } : {}),
        });
      const handle = await connectStudio({
        side: "receiver",
        ticket,
        request,
        signal: slot.abort.signal,
        onVideo: (stream) => {
          if (closed || slot.epoch !== current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          slot.value = { ...slot.value, stream };
          options.onCamera(role, slot.value);
        },
        onMetrics: (metrics) => {
          if (closed || slot.epoch !== current) return;
          slot.value = {
            ...slot.value,
            metrics,
            status: metrics.direct
              ? "Verified direct"
              : "Verifying direct path",
          };
          options.onCamera(role, slot.value);
        },
        onStop: () => {
          if (closed || slot.epoch !== current) return;
          slot.failedNegotiation = ticket.negotiationId!;
          clearSlot(role, "Camera stopped — reconnect on its device");
        },
      });
      if (closed || slot.epoch !== current) handle.stop();
      else slot.handle = handle;
    } catch {
      if (!closed && slot.epoch === attempt && slot.negotiation) {
        slot.failedNegotiation = slot.negotiation;
        clearSlot(role, "Camera stopped — reconnect on its device");
      }
      // An unpaired camera remains an independent waiting slot.
    } finally {
      slot.busy = false;
    }
  }
  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      const result = await call();
      if (closed) return;
      if (!result.game || result.game.id !== options.gameId) throw Error();
      options.onGame(result.game);
      programRoles.forEach((role) => void updateSlot(role));
    } catch {
      if (!closed) {
        stop();
        options.onError(
          "Program access ended or the server is unavailable. Prepare a fresh source from the operator page.",
        );
      }
    } finally {
      polling = false;
    }
  }
  const timer = setInterval(() => void poll(), 2_000);
  function stop() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    controllers.forEach((controller) => controller.abort());
    programRoles.forEach((role) => clearSlot(role, "Program stopped"));
  }
  void poll();
  return { stop };
}
