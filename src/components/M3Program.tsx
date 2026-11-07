"use client";
import { useEffect, useRef, useState } from "react";
import { ProgramCanvas } from "./ProgramCanvas";
import type { BroadcastGame } from "@/lib/game-projection";
import type { CameraRole } from "@/lib/m2-studio-protocol";
import {
  startProgramReceiver,
  type ProgramCamera,
} from "@/lib/providers/m3-program-browser";

function Feed({ value, role }: { value?: ProgramCamera; role: CameraRole }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current!;
    element.srcObject = value?.stream ?? null;
    if (value?.stream) void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [value?.stream]);
  const verified = Boolean(value?.metrics?.direct && value.stream);
  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-label={`${role === "camera-home" ? "Camera 1" : "Camera 2"} complete frame`}
        className="h-full w-full"
        style={{
          objectFit: "contain",
          visibility: verified ? "visible" : "hidden",
        }}
      />
      {!verified && (
        <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-xl text-slate-300">
          {value?.status ?? "Waiting for camera"}
        </p>
      )}
    </div>
  );
}

export function M3Program({ id }: { id: string }) {
  const [game, setGame] = useState<BroadcastGame>();
  const [cameras, setCameras] = useState<
    Partial<Record<CameraRole, ProgramCamera>>
  >({});
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const exchange = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    let receiver: ReturnType<typeof startProgramReceiver> | undefined;
    const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    // Keep a single handoff exchange across React StrictMode's setup/cleanup replay.
    if (!exchange.current) {
      const code = new URLSearchParams(location.hash.slice(1)).get("code");
      history.replaceState(null, "", location.pathname);
      exchange.current = code
        ? fetch(`/api/games/${id}/studio-m3`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "exchange", code }),
            signal: AbortSignal.timeout(8_000),
          }).then((response) => {
            if (!response.ok) throw Error();
          })
        : Promise.resolve();
    }
    void exchange.current
      .then(() => {
        if (disposed) return;
        receiver = startProgramReceiver({
          gameId: id,
          onGame: (value) => {
            if (!disposed) setGame(value);
          },
          onCamera: (role, value) => {
            if (!disposed)
              setCameras((previous) => ({ ...previous, [role]: value }));
          },
          onError: (message) => {
            if (!disposed) {
              setGame(undefined);
              setError(message);
            }
          },
        });
      })
      .catch(() => {
        if (!disposed)
          setError(
            "This source invitation expired or was already used. Prepare a fresh OBS source.",
          );
      });
    const hide = () => receiver?.stop();
    window.addEventListener("pagehide", hide);
    return () => {
      disposed = true;
      receiver?.stop();
      window.removeEventListener("resize", fit);
      window.removeEventListener("pagehide", hide);
    };
  }, [id]);
  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      {error ? (
        <p
          role="alert"
          className="max-w-3xl p-12 text-center text-3xl text-white"
        >
          {error}
        </p>
      ) : game ? (
        <div style={{ width: 1920 * scale, height: 1080 * scale }}>
          <div
            data-testid="m3-program-frame"
            style={{
              width: 1920,
              height: 1080,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <ProgramCanvas
              game={game}
              renderCamera={(role) => (
                <Feed role={role} value={cameras[role]} />
              )}
              statusLabel="LOCAL PROGRAM"
              audioStatus="Video only"
            />
          </div>
        </div>
      ) : (
        <p className="p-12 text-3xl text-white">Opening private program…</p>
      )}
    </main>
  );
}
