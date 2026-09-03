"use client";
import { use, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createLocalVideoTrack } from "livekit-client";
import { useGame } from "@/components/GameSync";
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
  const [state, setState] = useState<ConnectionState>("idle");
  const [landscape, setLandscape] = useState(false);
  const [error, setError] = useState("");
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
      removeEventListener("resize", update);
      room.current?.disconnect();
    };
  }, []);

  async function connect() {
    setError("");
    transition("connect");
    try {
      room.current?.disconnect();
      const access = localStorage.getItem(`curlcast-access-${id}`);
      const response = await fetch(`/api/games/${id}/livekit-token`, {
        method: "POST",
        headers: access ? { authorization: `Bearer ${access}` } : {},
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const credentials = (await response.json()) as {
        url: string;
        token: string;
      };
      const nextRoom = new Room({ adaptiveStream: true, dynacast: true });
      room.current = nextRoom;
      nextRoom.on(RoomEvent.Disconnected, () => {
        transition("disconnect");
        void act({ type: "connection", role, connected: false }).catch(
          () => {},
        );
      });
      await nextRoom.connect(credentials.url, credentials.token);
      const track = await createLocalVideoTrack({
        facingMode: "environment",
        resolution: { width: 720, height: 1280, frameRate: 30 },
      });
      if (video.current) track.attach(video.current);
      await nextRoom.localParticipant.publishTrack(track, {
        source: Track.Source.Camera,
      });
      await (
        navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<unknown> };
        }
      ).wakeLock?.request("screen");
      transition("published");
      await act({ type: "connection", role, connected: true });
    } catch (cause) {
      room.current?.disconnect();
      const denied =
        cause instanceof DOMException && cause.name === "NotAllowedError";
      transition(denied ? "permission-denied" : "disconnect");
      setError(
        denied
          ? "Camera permission is needed. Open browser settings, allow Camera, then retry. Audio is never requested."
          : cause instanceof Error
            ? cause.message
            : "Could not connect to live video. Check the network and retry.",
      );
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
      <div className="relative mx-auto aspect-[9/16] max-h-[70vh] overflow-hidden rounded-2xl border-4 border-slate-600 bg-gradient-to-b from-slate-700 to-blue-950">
        <video
          ref={video}
          muted
          playsInline
          autoPlay
          className="safe-video h-full w-full"
        />
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
        Rear camera · approximately 720×1280 · 30 fps · audio disabled
      </p>
    </main>
  );
}
