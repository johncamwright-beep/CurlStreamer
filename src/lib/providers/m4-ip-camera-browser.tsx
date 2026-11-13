"use client";

import { useEffect } from "react";
import { createM4CameraFramePainter } from "./m4-camera-image-browser";
import { m4RendererInstance } from "./m4-renderer-health-browser";
import { cameraAspect } from "../program-camera-layout";
import { createProgramVideoPlayout } from "./program-video-playout-browser";
import type { ConnectionDiagnosticInput } from "./connection-diagnostics";
import type { CameraRole } from "../m2-studio-protocol";

const FRAME_INTERVAL_MS = 1000 / 30;
const OBSERVATION_INTERVAL_MS = 1000;
const DIAGNOSTIC_INTERVAL_MS = 10_000;
const FRESHNESS_MS = 5000;
const MAX_JPEG_BYTES = 2 * 1024 * 1024;

/** Only the private program renderer can fetch these uncredentialed loopback
 * paths. RTSP addresses and camera passwords never reach browser JavaScript. */
export function M4IpCameraTransport({
  role,
  generation,
  sourceIdentity,
  onChange,
  diagnostic,
  delayMs = 0,
}: {
  role: CameraRole;
  generation: number;
  sourceIdentity: string;
  delayMs?: number;
  diagnostic: (event: ConnectionDiagnosticInput) => void;
  onChange(
    role: CameraRole,
    state: {
      canvas?: HTMLCanvasElement;
      aspect?: number;
      sourceIdentity: string;
      message: string;
    },
  ): void;
}) {
  useEffect(() => {
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");
    canvas.style.objectFit = "contain";
    const context = canvas.getContext("2d");
    let displayed = false;
    let publishedAspect: number | undefined;
    let counter = 0;
    let lastFrame = 0;
    let observation: AbortController | undefined;
    let lastObservation = -Infinity;
    const startedAt = Date.now();
    const reports = new Map<string, number>();
    const report = (
      code: ConnectionDiagnosticInput["code"],
      action?: ConnectionDiagnosticInput["action"],
      status?: number,
    ) => {
      if (lifetime.signal.aborted) return;
      const key = action ? code + ":" + action : code;
      const now = performance.now();
      if (now - (reports.get(key) ?? -Infinity) < DIAGNOSTIC_INTERVAL_MS)
        return;
      reports.set(key, now);
      diagnostic({ layer: "media", code, role, action, status });
    };
    const paintFrame = createM4CameraFramePainter(
      canvas,
      (timedOut) => report(timedOut ? "timeout" : "capture_failed"),
      () => report("retry"),
    );
    const publish = (width: number, height: number) => {
      const aspect = cameraAspect(width, height);
      if (!displayed || aspect !== publishedAspect) {
        onChange(role, {
          sourceIdentity,
          canvas,
          aspect,
          message: "Receiving IP video",
        });
        publishedAspect = aspect;
      }
      displayed = true;
    };
    const playout =
      delayMs > 0
        ? createProgramVideoPlayout({
            canvas,
            delayMs,
            paintFrame,
            onFrame: publish,
            onStale: () => {
              report("paint_stale");
              displayed = false;
              onChange(role, {
                sourceIdentity,
                message: "Reconnecting IP camera…",
              });
            },
          })
        : undefined;
    const observe = () => {
      if (
        observation ||
        performance.now() - lastObservation < OBSERVATION_INTERVAL_MS
      )
        return;
      lastObservation = performance.now();
      const attempt = new AbortController();
      observation = attempt;
      const timeout = setTimeout(() => attempt.abort(), 2000);
      // Health reporting must never hold up delivery of the next picture.
      void fetch("/camera", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.any([lifetime.signal, attempt.signal]),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "observe",
          rendererInstance: m4RendererInstance(),
          cameraRole: role,
          frames: counter,
          verified: playout ? playout.isFresh() : displayed,
          sourceGeneration: generation,
        }),
      })
        .then(async (response) => {
          await response.text();
          if (!response.ok)
            report("verification_failed", "observe", response.status);
        })
        .catch(() =>
          report(
            attempt.signal.aborted ? "timeout" : "transport_failed",
            "observe",
          ),
        )
        .finally(() => {
          clearTimeout(timeout);
          attempt.abort();
          if (observation === attempt) observation = undefined;
        });
    };
    const clear = () => {
      playout?.clear();
      context?.clearRect(0, 0, canvas.width, canvas.height);
      displayed = false;
      lastFrame = 0;
      onChange(role, { sourceIdentity, message: "Reconnecting IP camera…" });
    };
    const readFrame = async () => {
      const attempt = new AbortController();
      const timeout = setTimeout(() => attempt.abort(), 2000);
      const signal = AbortSignal.any([lifetime.signal, attempt.signal]);
      try {
        const response = await fetch(
          `/ip-camera/${role}/frame?generation=${generation}&after=${counter}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal,
          },
        );
        if (lifetime.signal.aborted) return;
        if (response.status === 204) {
          if (Date.now() - (lastFrame || startedAt) >= FRESHNESS_MS)
            report("paint_stale", "read");
          return;
        }
        if (!response.ok) {
          report("transport_failed", "read", response.status);
          return;
        }
        if (
          response.headers.get("content-type") !== "image/jpeg" ||
          response.headers.get("x-m4-ip-camera-generation") !==
            String(generation) ||
          Number(response.headers.get("content-length")) > MAX_JPEG_BYTES
        )
          throw Error();
        const frame = Number(response.headers.get("x-m4-ip-camera-frame"));
        if (!Number.isSafeInteger(frame) || frame <= counter) throw Error();
        const image = await response.blob();
        if (image.size > MAX_JPEG_BYTES || !image.size) throw Error();
        if (lifetime.signal.aborted || attempt.signal.aborted) return;
        return { frame, image };
      } catch {
        report(attempt.signal.aborted ? "timeout" : "transport_failed", "read");
      } finally {
        clearTimeout(timeout);
        attempt.abort();
      }
    };
    const poll = async () => {
      const started = performance.now();
      const next = await readFrame();
      if (lifetime.signal.aborted) return;
      if (next) {
        // Skip a failed decode and let the next poll fetch the newest JPEG.
        counter = next.frame;
        if (playout) {
          lastFrame = Date.now();
          playout.enqueue(next.image);
          observe();
        } else {
          const painted = await paintFrame(next.image, lifetime.signal);
          if (painted && !lifetime.signal.aborted) {
            publish(painted.width, painted.height);
            lastFrame = Date.now();
            observe();
          }
        }
      }
      if (lifetime.signal.aborted) return;
      if (lastFrame > 0 && Date.now() - lastFrame >= FRESHNESS_MS) {
        report("paint_stale");
        clear();
      }
      timer = setTimeout(
        () => void poll(),
        Math.max(0, FRAME_INTERVAL_MS - (performance.now() - started)),
      );
    };
    onChange(role, { sourceIdentity, message: "Connecting IP camera…" });
    void poll();
    return () => {
      lifetime.abort();
      playout?.stop();
      observation?.abort();
      clearTimeout(timer);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    };
  }, [role, generation, sourceIdentity, onChange, diagnostic, delayMs]);
  return null;
}
