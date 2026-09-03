"use client";
import { use, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { LocalVideoTrack } from "livekit-client";
import { useGame } from "@/components/GameSync";
import { PortraitVideo } from "@/components/PortraitVideo";
import {
  acquireVerifiedPortraitCamera,
  cameraCapabilityError,
  cameraPermissionGuidance,
  deviceIsPortrait,
  disposeCameraResources,
  isPermissionError,
  SingleFlightGate,
} from "@/lib/providers/livekit-client";
import { OptionalScreenWakeLock } from "@/lib/providers/screen-wake-lock";
import {
  nextConnectionState,
  type ConnectionState,
  type ConnectionEvent,
} from "@/lib/livekit-state";

const labels: Record<ConnectionState, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  live: "● Live",
  disconnected: "Disconnected",
  "permission-denied": "Permission denied",
};

export default function Camera({
  params,
}: {
  params: Promise<{ id: string; role: "camera-home" | "camera-away" }>;
}) {
  const { id, role } = use(params);
  const { game, act } = useGame(id);
  const video = useRef<HTMLVideoElement>(null);
  const room = useRef<Room | undefined>(undefined);
  const cameraTrack = useRef<LocalVideoTrack | undefined>(undefined);
  const connectionGate = useRef(new SingleFlightGate());
  const attempt = useRef(0);
  const cleanupFlight = useRef<Promise<void> | undefined>(undefined);
  const disconnected = useRef(true);
  const wakeLock = useRef<OptionalScreenWakeLock | undefined>(undefined);
  const mounted = useRef(true);
  const removedByOrganizer = useRef(false);
  const [state, setState] = useState<ConnectionState>("idle");
  const [landscape, setLandscape] = useState(false);
  const [error, setError] = useState("");
  const [capture, setCapture] = useState("");
  const [source, setSource] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [warning, setWarning] = useState("");
  const [battery, setBattery] = useState<string>();
  const [previewReady, setPreviewReady] = useState(false);
  const transition = (event: ConnectionEvent) =>
    setState((current) => nextConnectionState(current, event));

  useEffect(() => {
    mounted.current = true;
    const update = () => setLandscape(innerWidth > innerHeight);
    const close = () => void disconnectCamera(false);
    update();
    addEventListener("resize", update);
    addEventListener("beforeunload", close);
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    void nav
      .getBattery?.()
      .then((b) => setBattery(`${Math.round(b.level * 100)}%`));
    return () => {
      mounted.current = false;
      removeEventListener("resize", update);
      removeEventListener("beforeunload", close);
      close();
    };
  }, []);

  async function disconnectCamera(manual = true) {
    ++attempt.current;
    if (disconnected.current && !cleanupFlight.current) {
      connectionGate.current.leave();
      if (mounted.current && manual) {
        transition("disconnect");
        setConfirmation("Camera disconnected safely");
      }
      return;
    }
    disconnected.current = true;
    if (cleanupFlight.current) {
      await cleanupFlight.current;
    } else {
      const currentRoom = room.current;
      const currentTrack = cameraTrack.current;
      cameraTrack.current = undefined;
      // Stopping synchronously makes the camera indicator go out immediately.
      currentTrack?.detach();
      currentTrack?.stop();
      cleanupFlight.current = (async () => {
        if (currentTrack) {
          try {
            await currentRoom?.localParticipant.unpublishTrack(currentTrack);
          } catch {
            // Departure still proceeds if the publication has already gone.
          }
        }
        currentRoom?.disconnect();
        try {
          await wakeLock.current?.release();
        } finally {
          wakeLock.current = undefined;
        }
      })().finally(() => {
        cleanupFlight.current = undefined;
      });
      await cleanupFlight.current;
    }
    connectionGate.current.leave();
    if (!mounted.current) return;
    transition("disconnect");
    setCapture("");
    setSource("");
    setPreviewReady(false);
    if (manual) setConfirmation("Camera disconnected safely");
    await act({
      type: "camera-health",
      role,
      phase: "disconnected",
      ...(removedByOrganizer.current
        ? { diagnostic: "Disconnected by organizer" }
        : {}),
    }).catch(() => {});
  }

  async function connect() {
    if (!connectionGate.current.enter()) return;
    const thisAttempt = ++attempt.current;
    disconnected.current = false;
    removedByOrganizer.current = false;
    setError("");
    setCapture("");
    setSource("");
    setConfirmation("");
    setWarning("");
    setConnectionStatus("Waiting for camera permission");
    transition("connect");
    void act({
      type: "camera-health",
      role,
      phase: state === "live" ? "reconnecting" : "connecting",
    }).catch(() => {});
    let stage = "camera acquisition";
    let acquired = false;
    try {
      const capabilityError = cameraCapabilityError(
        navigator,
        window.isSecureContext,
      );
      if (capabilityError) throw new Error(`Camera error: ${capabilityError}`);
      // This call is deliberately made in the click stack, before any await or
      // token/LiveKit work, which is required by iOS Chrome's user activation.
      if (!video.current) throw new Error("Camera preview is unavailable.");
      const acquisition = acquireVerifiedPortraitCamera(
        navigator.mediaDevices,
        video.current,
        deviceIsPortrait(screen.orientation, innerWidth, innerHeight),
      );
      const { track, report } = await acquisition;
      acquired = true;
      setConnectionStatus("Starting camera");
      if (thisAttempt !== attempt.current) {
        await disposeCameraResources(undefined, track);
        return;
      }
      cameraTrack.current = track;
      setWarning(report.warning ?? "");
      const settings = track.mediaStreamTrack.getSettings();
      setCapture(
        `${settings.width ?? "unknown"}×${settings.height ?? "unknown"} · ${settings.frameRate ?? "unknown"} fps · ${settings.facingMode ?? "unknown camera"}`,
      );
      if (video.current) track.attach(video.current);

      stage = "room preparation";
      const nextRoom = new Room({ adaptiveStream: true, dynacast: true });
      room.current = nextRoom;

      stage = "token fetching";
      const access = localStorage.getItem(`curlcast-access-${id}`);
      let response: Response;
      try {
        response = await fetch(`/api/games/${id}/livekit-token`, {
          method: "POST",
          headers: access ? { authorization: `Bearer ${access}` } : {},
        });
      } catch {
        throw new Error("Token error: unable to reach the credential service.");
      }
      if (!response.ok)
        throw new Error(
          `Token error: access unavailable (${response.status}).`,
        );
      const credentials = (await response.json()) as {
        url: string;
        token: string;
      };
      nextRoom.on(RoomEvent.Reconnecting, () => {
        if (mounted.current)
          void act({
            type: "camera-health",
            role,
            phase: "reconnecting",
          }).catch(() => {});
      });
      nextRoom.on(RoomEvent.Disconnected, (reason?: number) => {
        if (!mounted.current) return;
        removedByOrganizer.current = reason === 4;
        void disconnectCamera(false).then(() => {
          if (!mounted.current) return;
          if (removedByOrganizer.current) {
            setConfirmation("Disconnected by organizer.");
            setConnectionStatus("Reconnect manually when you are ready.");
          }
        });
      });
      if (thisAttempt !== attempt.current) {
        await disconnectCamera(false);
        return;
      }
      stage = "LiveKit connection";
      try {
        await nextRoom.connect(credentials.url, credentials.token);
      } catch {
        throw new Error("Connection error: could not join the LiveKit room.");
      }
      if (thisAttempt !== attempt.current) {
        await disconnectCamera(false);
        return;
      }
      stage = "track publication";
      try {
        await nextRoom.localParticipant.publishTrack(track, {
          source: Track.Source.Camera,
        });
      } catch {
        throw new Error(
          "Publication error: the camera track could not be published.",
        );
      }
      if (thisAttempt !== attempt.current) {
        await disconnectCamera(false);
        return;
      }
      await act({ type: "camera-health", role, phase: "live" });
      if (thisAttempt !== attempt.current) {
        await disconnectCamera(false);
        return;
      }
      transition("published");
      setConnectionStatus("");
      wakeLock.current = new OptionalScreenWakeLock(
        navigator,
        document,
        (message) => mounted.current && setWarning(message),
      );
      wakeLock.current.start();
      const heartbeat = window.setInterval(() => {
        if (!disconnected.current)
          void act({ type: "camera-health", role, phase: "live" }).catch(
            () => {},
          );
      }, 30_000);
      nextRoom.once(RoomEvent.Disconnected, () => clearInterval(heartbeat));
    } catch (cause) {
      const name =
        typeof cause === "object" && cause && "name" in cause
          ? String(cause.name).replace(/[^a-zA-Z0-9_-]/g, "") || "Error"
          : "Error";
      const denied = !acquired && isPermissionError(cause);
      const message = denied
        ? `Permission error (${name}) at ${stage}: camera access was denied. ${cameraPermissionGuidance(navigator.userAgent)} Audio is never requested.`
        : `${cause instanceof Error ? cause.message : "Camera connection failed"} (${name}) at ${stage}.`;
      await disconnectCamera(false);
      transition(denied ? "permission-denied" : "disconnect");
      setConnectionStatus(denied ? "Permission denied" : "");
      if (mounted.current) setError(message);
      void act({
        type: "camera-health",
        role,
        phase: denied ? "attention" : "disconnected",
        diagnostic: denied ? "Camera permission denied" : "Connection failed",
      }).catch(() => {});
    } finally {
      if (thisAttempt === attempt.current) connectionGate.current.leave();
    }
  }
  if (game?.status === "closed")
    return (
      <main className="mx-auto max-w-lg p-5">
        <div role="alert" className="panel text-center">
          <h1 className="text-2xl font-black">This game is closed</h1>
          <p className="mt-2 text-slate-300">
            Camera access has been revoked. You can safely close this page.
          </p>
        </div>
      </main>
    );
  return (
    <main className="mx-auto min-h-screen max-w-lg p-3">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-cyan-300">
            {role === "camera-home" ? "HOME END" : "AWAY END"}
          </p>
          <h1 className="text-2xl font-black">Portrait camera</h1>
        </div>
        <span
          aria-live="polite"
          className={
            state === "live"
              ? "rounded-full bg-emerald-500 px-3 py-2 font-bold"
              : "rounded-full bg-slate-700 px-3 py-2"
          }
        >
          {labels[state]}
        </span>
      </header>
      {landscape && (
        <div
          role="alert"
          className="mb-3 rounded-xl bg-amber-400 p-4 font-bold text-slate-950"
        >
          ↻ Rotate and mount this phone vertically.
        </div>
      )}
      <div className="portrait-camera-panel camera-preview-panel mx-auto rounded-2xl border-4 border-slate-600 bg-gradient-to-b from-slate-700 to-blue-950">
        <PortraitVideo
          ref={video}
          muted
          autoPlay
          onPlaying={() => setPreviewReady(true)}
          onEmptied={() => setPreviewReady(false)}
          onSourceDetails={setSource}
        />
        {!previewReady && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-[12%] bottom-[5%] aspect-square rounded-full border-2 border-red-400/70"
          >
            <div className="absolute inset-[25%] rounded-full border-2 border-white/70" />
          </div>
        )}
        {!previewReady && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-full border-l border-dashed border-white/40"
          />
        )}
        <div className="absolute inset-x-3 top-3 flex justify-between text-xs">
          <span>{navigator.onLine ? "Network online" : "Network offline"}</span>
          {battery && <span>Battery {battery}</span>}
        </div>
      </div>
      <p className="my-3 text-center text-sm text-slate-300">
        Keep the house inside the rings and the sheet aligned to the centre
        guide. Do not lock this phone or leave this page.
      </p>
      {state !== "live" && (
        <button
          disabled={state === "connecting"}
          onClick={connect}
          className="btn w-full text-xl"
        >
          {state === "connecting"
            ? "Connecting…"
            : state === "permission-denied"
              ? "Retry Connection"
              : "Connect Camera"}
        </button>
      )}
      {(state === "connecting" || state === "live") && (
        <button
          onClick={() => void disconnectCamera()}
          className="btn-secondary mt-3 min-h-11 w-full text-xl"
        >
          Disconnect Camera
        </button>
      )}
      {connectionStatus && (
        <p role="status" className="mt-3 text-center text-slate-200">
          {connectionStatus}
        </p>
      )}
      {confirmation && (
        <p role="status" className="mt-3 text-center text-emerald-300">
          {confirmation}
        </p>
      )}
      {warning && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-amber-950 p-4 text-amber-200"
        >
          {warning}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      <p className="mt-3 text-center text-xs text-slate-400">
        Requested: rear camera · 720×1280 (9:16) · 30 fps · audio disabled
      </p>
      {capture && (
        <p className="mt-1 text-center text-xs text-slate-300">
          Actual capture: {capture}
        </p>
      )}
      {source && (
        <p className="mt-1 text-center text-xs text-slate-300">
          Video element: {source}
        </p>
      )}
    </main>
  );
}
