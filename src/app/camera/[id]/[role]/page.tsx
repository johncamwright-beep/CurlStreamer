"use client";
import { use, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createLocalTracks } from "livekit-client";
import type { LocalVideoTrack } from "livekit-client";
import { useGame } from "@/components/GameSync";
import { PortraitVideo } from "@/components/PortraitVideo";
import {
  cameraCapabilityError,
  cameraPermissionGuidance,
  disposeCameraResources,
  isPermissionError,
  portraitMediaOptions,
  SingleFlightGate,
} from "@/lib/providers/livekit-client";
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
  const mounted = useRef(true);
  const [state, setState] = useState<ConnectionState>("idle");
  const [landscape, setLandscape] = useState(false);
  const [error, setError] = useState("");
  const [capture, setCapture] = useState("");
  const [battery, setBattery] = useState<string>();
  const transition = (event: ConnectionEvent) =>
    setState((current) => nextConnectionState(current, event));

  useEffect(() => {
    const update = () => setLandscape(innerWidth > innerHeight);
    update();
    addEventListener("resize", update);
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    void nav
      .getBattery?.()
      .then((b) => setBattery(`${Math.round(b.level * 100)}%`));
    return () => {
      mounted.current = false;
      removeEventListener("resize", update);
      const currentRoom = room.current;
      const currentTrack = cameraTrack.current;
      cameraTrack.current = undefined;
      void disposeCameraResources(
        currentRoom?.localParticipant,
        currentTrack,
      ).finally(() => currentRoom?.disconnect());
    };
  }, []);

  async function connect() {
    if (!connectionGate.current.enter()) return;
    setError("");
    setCapture("");
    transition("connect");
    try {
      const capabilityError = cameraCapabilityError(
        navigator,
        window.isSecureContext,
      );
      if (capabilityError) throw new Error(`Camera error: ${capabilityError}`);
      const nextRoom =
        room.current ?? new Room({ adaptiveStream: true, dynacast: true });
      room.current = nextRoom;
      nextRoom.removeAllListeners();
      await disposeCameraResources(
        nextRoom.localParticipant,
        cameraTrack.current,
      );
      cameraTrack.current = undefined;
      nextRoom.disconnect();

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
      nextRoom.on(RoomEvent.Disconnected, () => {
        if (!mounted.current) return;
        transition("disconnect");
        void act({ type: "connection", role, connected: false }).catch(
          () => {},
        );
      });
      try {
        await nextRoom.connect(credentials.url, credentials.token);
      } catch {
        throw new Error("Connection error: could not join the LiveKit room.");
      }
      let track: LocalVideoTrack;
      try {
        const tracks = await createLocalTracks(portraitMediaOptions);
        const videoTrack = tracks.find(
          (candidate): candidate is LocalVideoTrack =>
            candidate.kind === Track.Kind.Video,
        );
        if (!videoTrack) throw new Error("No camera track returned");
        track = videoTrack;
      } catch (cause) {
        if (isPermissionError(cause)) {
          throw new Error(
            `Permission error: camera access was denied. ${cameraPermissionGuidance(navigator.userAgent)} Audio is never requested.`,
          );
        }
        throw new Error("Camera error: the rear camera could not be started.");
      }
      cameraTrack.current = track;
      const settings = track.mediaStreamTrack.getSettings();
      setCapture(
        `${settings.width ?? "unknown"}×${settings.height ?? "unknown"} · ${settings.frameRate ?? "unknown"} fps · ${settings.facingMode ?? "unknown camera"}`,
      );
      if (video.current) track.attach(video.current);
      try {
        await nextRoom.localParticipant.publishTrack(track, {
          source: Track.Source.Camera,
        });
      } catch {
        throw new Error(
          "Publication error: the camera track could not be published.",
        );
      }
      await (
        navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<unknown> };
        }
      ).wakeLock?.request("screen");
      transition("published");
      await act({ type: "connection", role, connected: true });
    } catch (cause) {
      const currentRoom = room.current;
      await disposeCameraResources(
        currentRoom?.localParticipant,
        cameraTrack.current,
      );
      cameraTrack.current = undefined;
      currentRoom?.disconnect();
      const message =
        cause instanceof Error
          ? cause.message
          : "Connection error: could not connect to live video.";
      transition(
        message.startsWith("Permission error:")
          ? "permission-denied"
          : "disconnect",
      );
      if (mounted.current) setError(message);
    } finally {
      connectionGate.current.leave();
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
      <div className="portrait-camera-panel mx-auto h-[min(70vh,calc((100vw-1.5rem)*16/9))] max-w-full rounded-2xl border-4 border-slate-600 bg-gradient-to-b from-slate-700 to-blue-950">
        <PortraitVideo ref={video} muted autoPlay />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[12%] bottom-[5%] aspect-square rounded-full border-2 border-red-400/70"
        >
          <div className="absolute inset-[25%] rounded-full border-2 border-white/70" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-full border-l border-dashed border-white/40"
        />
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
          {state === "idle"
            ? "Connect Camera"
            : state === "connecting"
              ? "Connecting…"
              : "Retry Connection"}
        </button>
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
    </main>
  );
}
