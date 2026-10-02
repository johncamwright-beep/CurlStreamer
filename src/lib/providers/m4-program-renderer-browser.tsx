"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ProgramCanvas,
  type ProgramCameraRole,
} from "@/components/ProgramCanvas";
import type { BroadcastGame } from "@/lib/game-projection";
import type { DirectMetrics } from "./direct-peer";
import { connectM4ProgramCamera } from "./m4-program-camera";
import { ProgramPhoneAudio } from "@/components/ProgramPhoneAudio";
import { ProgramUsbAudio } from "@/components/ProgramUsbAudio";
import {
  StudioTransportUnavailable,
  isTemporaryStudioStatus,
} from "./studio-transport-error";
import {
  connectionFailureReason,
  type ConnectionDiagnosticInput,
} from "./connection-diagnostics";

function log(event: ConnectionDiagnosticInput) {
  void request(
    "/camera",
    { action: "diagnostic", event },
    AbortSignal.timeout(2_000),
  ).catch(() => undefined);
}

import {
  CameraConnectionCoordinator,
  ConnectionFailure,
} from "./camera-connection-coordinator";

import { z } from "zod";
import {
  m4CameraInputSnapshotSchema,
  type M4CameraInputSnapshot,
} from "../m4-camera-input";
import { M4IpCameraTransport } from "./m4-ip-camera-browser";

type CameraState = {
  frameUrl?: string;
  stream?: MediaStream;
  audio?: MediaStream;
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
  if (isTemporaryStudioStatus(response.status) && !response.redirected)
    throw new StudioTransportUnavailable();
  if ([401, 403, 410].includes(response.status) || response.redirected)
    throw new ConnectionFailure("authority_rejected", false);
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
      {state.frameUrl ? (
        <img
          className="portrait-camera-video"
          src={state.frameUrl}
          alt="Tapo camera"
          style={{ objectFit: "contain" }}
        />
      ) : (
        <video
          className="portrait-camera-video"
          ref={ref}
          autoPlay
          playsInline
          muted
          aria-label="Direct camera"
        />
      )}
      {!state.stream && !state.frameUrl && (
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
            Connect this camera from the game screen.
          </p>
        </div>
      )}
    </>
  );
}

function PhoneCameraTransport({
  role,
  sourceGeneration,
  onChange,
}: {
  role: ProgramCameraRole;
  sourceGeneration: number;
  onChange: (role: ProgramCameraRole, state: CameraState) => void;
}) {
  const [cameras, setCameras] = useState<
    Record<ProgramCameraRole, CameraState>
  >({
    "camera-home": { message: "Connecting Camera 1…" },
    "camera-away": { message: "Connecting Camera 2…" },
  });
  useEffect(() => onChange(role, cameras[role]), [cameras, role, onChange]);
  useEffect(() => {
    const lifetime = new AbortController();
    const owners = [role].map((role) => {
      let sampleAt = 0;
      let observationFlight = false;
      return new CameraConnectionCoordinator({
        connect: async (attempt) => {
          attempt.phase("waiting-studio");
          try {
            return await connectM4ProgramCamera({
              role,
              request,
              signal: attempt.signal,
              onVideo: (stream) => {
                if (!attempt.current()) return;
                log({ layer: "media", code: "ready", role });
                setCameras((current) => ({
                  ...current,
                  [role]: { ...current[role], stream },
                }));
              },
              onAudio: (audio) => {
                if (attempt.current())
                  setCameras((current) => ({
                    ...current,
                    [role]: { ...current[role], audio },
                  }));
              },
              onMetrics: (metrics) => {
                if (!attempt.current()) return;
                attempt.phase(metrics.direct ? "streaming" : "negotiating");
                if (Date.now() - sampleAt >= 15_000) {
                  sampleAt = Date.now();
                  log({
                    layer: "media",
                    code: "sample",
                    role,
                    direct: metrics.direct,
                    connection: metrics.connectionState,
                    ice: metrics.iceConnectionState,
                    frames: metrics.framesDecoded,
                    bytes: metrics.bytesReceived,
                  });
                }
                if (!observationFlight) {
                  observationFlight = true;
                  const deadline = new AbortController();
                  const timer = setTimeout(() => deadline.abort(), 5000);
                  void request(
                    "/camera",
                    {
                      action: "observe",
                      cameraRole: role,
                      frames: metrics.framesDecoded,
                      verified: metrics.direct,
                      sourceGeneration,
                    },
                    AbortSignal.any([attempt.signal, deadline.signal]),
                  )
                    .catch(() => undefined)
                    .finally(() => {
                      clearTimeout(timer);
                      observationFlight = false;
                    });
                }
                setCameras((current) =>
                  current[role].metrics?.direct === metrics.direct
                    ? current
                    : { ...current, [role]: { ...current[role], metrics } },
                );
              },
              onStop: (message, failure) => {
                if (!attempt.current()) return;
                const reason =
                  failure ??
                  new ConnectionFailure(connectionFailureReason(message), true);
                log({ layer: "peer", code: reason.code, role });
                attempt.fail(reason);
              },
            });
          } catch (cause) {
            if (cause instanceof ConnectionFailure) throw cause;
            throw new ConnectionFailure(
              cause instanceof StudioTransportUnavailable
                ? "network_unavailable"
                : "studio_stale",
              true,
            );
          }
        },
        release: () => {
          if (!lifetime.signal.aborted)
            setCameras((current) => ({
              ...current,
              [role]: { message: "Waiting for camera…" },
            }));
        },
        onState: (state) => {
          if (lifetime.signal.aborted) return;
          const message =
            state.phase === "streaming"
              ? "Verified direct camera"
              : state.phase === "retrying"
                ? "Reconnecting camera…"
                : state.phase === "blocked"
                  ? "Camera access ended. Reconnect from the scoring screen."
                  : state.phase === "negotiating"
                    ? "Verifying direct path…"
                    : "Waiting for camera…";
          log({
            layer: "session",
            code:
              state.phase === "retrying"
                ? "retry"
                : state.phase === "streaming"
                  ? "ready"
                  : state.phase === "blocked"
                    ? "authority_rejected"
                    : "started",
            role,
            attempt: state.attempt,
            ...(state.retryInMs === undefined
              ? {}
              : { durationMs: state.retryInMs }),
          });
          setCameras((current) =>
            current[role].message === message
              ? current
              : { ...current, [role]: { ...current[role], message } },
          );
        },
      });
    });
    owners.forEach((owner) => void owner.start());
    return () => {
      lifetime.abort();
      owners.forEach((owner) => owner.close());
    };
  }, [role, sourceGeneration]);
  return null;
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
        timer = setTimeout(() => void poll(), 1000);
      } catch {
        if (!controller.signal.aborted) {
          setProgramMessage("Reconnecting to Studio…");
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const [sources, setSources] =
    useState<Record<ProgramCameraRole, M4CameraInputSnapshot>>();
  const onCameraChange = useCallback(
    (role: ProgramCameraRole, state: CameraState) => {
      setCameras((current) => ({ ...current, [role]: state }));
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const schema = z
      .object({
        cameras: z
          .object({
            "camera-home": m4CameraInputSnapshotSchema,
            "camera-away": m4CameraInputSnapshotSchema,
          })
          .strict(),
      })
      .strict();
    const poll = async () => {
      const attempt = new AbortController();
      deadline = setTimeout(() => attempt.abort(), 3000);
      try {
        const value = schema.parse(
          await request(
            "/camera-inputs",
            undefined,
            AbortSignal.any([controller.signal, attempt.signal]),
          ),
        );
        if (!controller.signal.aborted)
          setSources((previous) =>
            previous &&
            roles.every(
              (role) =>
                previous[role].kind === value.cameras[role].kind &&
                previous[role].generation === value.cameras[role].generation,
            )
              ? previous
              : value.cameras,
          );
      } catch {
        /* A missed metadata poll does not tear down a working camera. */
      } finally {
        clearTimeout(deadline);
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(deadline);
    };
  }, []);

  if (!game)
    return (
      <main className="program-loading" role="status">
        {programMessage}
      </main>
    );

  const verified = roles.filter(
    (role) => cameras[role].metrics?.direct || cameras[role].frameUrl,
  ).length;
  return (
    <>
      <ProgramUsbAudio />
      {sources &&
        roles.map((role) =>
          sources[role].kind === "tapo" ? (
            <M4IpCameraTransport
              key={role + sources[role].kind + sources[role].generation}
              role={role}
              generation={sources[role].generation}
              onChange={onCameraChange}
            />
          ) : (
            <PhoneCameraTransport
              key={role + sources[role].kind + sources[role].generation}
              role={role}
              sourceGeneration={sources[role].generation}
              onChange={onCameraChange}
            />
          ),
        )}
      {sources &&
        roles
          .filter((role) => sources[role].kind === "tapo")
          .map((role) => (
            <ProgramUsbAudio
              key={role}
              endpoint={`/ip-camera/${role}/audio?generation=${sources[role].generation}&after=0`}
              generationHeader="x-m4-ip-camera-generation"
              role={role}
              sourceGeneration={sources[role].generation}
              enabled={game.cameraAudio?.[role]?.enabled === true}
              volume={game.cameraAudio?.[role]?.volume ?? 1}
            />
          ))}
      {roles.map((role) => (
        <ProgramPhoneAudio
          key={role}
          role={role}
          stream={
            sources?.[role].kind === "phone" ? cameras[role].audio : undefined
          }
          sourceGeneration={sources?.[role].generation}
          enabled={game.cameraAudio?.[role]?.enabled === true}
          volume={game.cameraAudio?.[role]?.volume ?? 1}
        />
      ))}
      <ProgramCanvas
        game={game}
        renderCamera={(role) => <CameraVideo state={cameras[role]} />}
        statusLabel={game.broadcast === "live" ? "LIVE" : programMessage}
        audioStatus={`${verified}/2 cameras receiving`}
      />
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("program_root_unavailable");
createRoot(root).render(<ProgramRenderer />);
