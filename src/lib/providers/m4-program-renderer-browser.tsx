"use client";

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ProgramCanvas,
  type ProgramCameraRole,
} from "@/components/ProgramCanvas";
import type { BroadcastGame } from "@/lib/game-projection";
import type { DirectMetrics } from "./direct-peer";
import { connectM4ProgramCamera } from "./m4-program-camera";

type CameraState = {
  stream?: MediaStream;
  metrics?: DirectMetrics;
  message: string;
};

const roles: ProgramCameraRole[] = ["camera-home", "camera-away"];

async function request(
  path: string,
  body: unknown | undefined,
  signal: AbortSignal,
) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok || response.redirected)
    throw new Error("program_unavailable");
  return response.json() as Promise<unknown>;
}

function CameraVideo({ state }: { state: CameraState }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = state.stream ?? null;
    if (state.stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [state.stream]);
  return (
    <>
      <video ref={ref} autoPlay playsInline muted aria-label="Direct camera" />
      {!state.stream && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeContent: "center",
            textAlign: "center",
            padding: 32,
            background: "#122332",
            color: "#b8c7d4",
            fontSize: 28,
          }}
        >
          <p>Camera not connected</p>
          <p style={{ fontSize: 20, marginTop: 12 }}>
            Connect your phone from the game screen.
          </p>
        </div>
      )}
    </>
  );
}

function ProgramRenderer() {
  const [game, setGame] = useState<BroadcastGame>();
  const [programMessage, setProgramMessage] = useState("Loading program…");
  const [cameras, setCameras] = useState<
    Record<ProgramCameraRole, CameraState>
  >({
    "camera-home": { message: "Connecting Camera 1…" },
    "camera-away": { message: "Connecting Camera 2…" },
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = (await request(
          "/program",
          undefined,
          controller.signal,
        )) as {
          game?: BroadcastGame;
        };
        if (!value.game || controller.signal.aborted) throw new Error();
        setGame(value.game);
        setProgramMessage("Local program ready");
        timer = setTimeout(() => void poll(), 500);
      } catch {
        if (!controller.signal.aborted)
          setProgramMessage(
            "Program authority ended. Reopen CurlStreamer Studio.",
          );
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const handles = new Map<ProgramCameraRole, { stop(): void }>();
    const retries = new Map<ProgramCameraRole, ReturnType<typeof setTimeout>>();
    const retry = (role: ProgramCameraRole) => {
      if (controller.signal.aborted || retries.has(role)) return;
      retries.set(
        role,
        setTimeout(() => {
          retries.delete(role);
          void connect(role);
        }, 1000),
      );
    };
    const connect = async (role: ProgramCameraRole) => {
      if (controller.signal.aborted || handles.has(role)) return;
      setCameras((current) => ({
        ...current,
        [role]: {
          message: `Waiting for ${role === "camera-home" ? "Camera 1" : "Camera 2"}…`,
        },
      }));
      try {
        const handle = await connectM4ProgramCamera({
          role,
          request,
          signal: controller.signal,
          onVideo: (stream) =>
            setCameras((current) => ({
              ...current,
              [role]: {
                ...current[role],
                stream,
                message: "Verified direct camera",
              },
            })),
          onMetrics: (metrics) =>
            setCameras((current) => ({
              ...current,
              [role]: {
                ...current[role],
                metrics,
                message: metrics.direct
                  ? "Verified direct camera"
                  : "Verifying direct path…",
              },
            })),
          onStop: (message) => {
            handles.delete(role);
            setCameras((current) => ({
              ...current,
              [role]: { metrics: current[role].metrics, message },
            }));
            retry(role);
          },
        });
        if (controller.signal.aborted) handle.stop();
        else handles.set(role, handle);
      } catch {
        if (!controller.signal.aborted) {
          setCameras((current) => ({
            ...current,
            [role]: {
              message: "Waiting for camera…",
            },
          }));
          retry(role);
        }
      }
    };
    for (const role of roles) void connect(role);
    return () => {
      controller.abort();
      retries.forEach((timer) => clearTimeout(timer));
      handles.forEach((handle) => handle.stop());
    };
  }, []);

  if (!game)
    return (
      <main className="program-loading" role="status">
        {programMessage}
      </main>
    );

  const verified = roles.filter((role) => cameras[role].metrics?.direct).length;
  return (
    <ProgramCanvas
      game={game}
      renderCamera={(role) => <CameraVideo state={cameras[role]} />}
      statusLabel={game.broadcast === "live" ? "LIVE" : programMessage}
      audioStatus={`${verified}/2 direct cameras verified · Video only`}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("program_root_unavailable");
createRoot(root).render(<ProgramRenderer />);
