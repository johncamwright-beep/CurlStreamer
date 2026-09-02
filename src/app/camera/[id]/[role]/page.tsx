"use client";
import { use, useEffect, useRef, useState } from "react";
import { useGame } from "@/components/GameSync";
export default function Camera({
  params,
}: {
  params: Promise<{ id: string; role: "camera-home" | "camera-away" }>;
}) {
  const { id, role } = use(params);
  const { game, act } = useGame(id);
  const video = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [error, setError] = useState("");
  const [battery, setBattery] = useState<string>();
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
    return () => removeEventListener("resize", update);
  }, []);
  async function connect() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 720 },
          height: { ideal: 1280 },
          aspectRatio: { ideal: 9 / 16 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      await (
        navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<unknown> };
        }
      ).wakeLock?.request("screen");
      setConnected(true);
      await act({ type: "connection", role, connected: true });
    } catch {
      setError(
        "Camera permission is needed. Open browser settings, allow Camera, then try again. No audio is requested.",
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
          className={
            connected
              ? "rounded-full bg-emerald-500 px-3 py-2 font-bold"
              : "rounded-full bg-slate-700 px-3 py-2"
          }
        >
          {connected ? "● Connected" : "Not connected"}
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
      {!connected && (
        <button onClick={connect} className="btn w-full text-xl">
          Connect Camera
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      <p className="mt-3 text-center text-xs text-slate-400">
        Requests rear 720×1280 · 30 fps · video only. LiveKit publishing begins
        in Milestone 4.
      </p>
    </main>
  );
}
