"use client";

import { useEffect } from "react";
import { decodeM4CameraBitmap } from "./m4-camera-image-browser";
import { m4RendererInstance } from "./m4-renderer-health-browser";
import { cameraAspect } from "../program-camera-layout";
import { createProgramVideoPlayout } from "./program-video-playout-browser";
import type { CameraRole } from "../m2-studio-protocol";

const FRAME_INTERVAL_MS = 1000 / 30;
const OBSERVATION_INTERVAL_MS = 1000;

/** Only the private program renderer can fetch these uncredentialed loopback
 * paths. RTSP addresses and camera passwords never reach browser JavaScript. */
export function M4IpCameraTransport({
  role,
  generation,
  sourceIdentity,
  onChange,
  delayMs = 0,
}: {
  role: CameraRole;
  generation: number;
  sourceIdentity: string;
  delayMs?: number;
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
            onFrame: publish,
            onStale: () => {
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
        .then((response) => response.text())
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timeout);
          attempt.abort();
          if (observation === attempt) observation = undefined;
        });
    };
    // createImageBitmap cannot be cancelled. Leave room for recovery after one
    // stalled decode, but never accumulate unbounded decoder work on retries.
    let pendingDecodes = 0;
    const clear = () => {
      playout?.clear();
      context?.clearRect(0, 0, canvas.width, canvas.height);
      displayed = false;
      lastFrame = 0;
      onChange(role, { sourceIdentity, message: "Reconnecting IP camera…" });
    };
    const poll = async () => {
      const started = performance.now();
      if (pendingDecodes >= 2) {
        if (lastFrame > 0 && Date.now() - lastFrame >= 5000) clear();
        if (!lifetime.signal.aborted)
          timer = setTimeout(() => void poll(), FRAME_INTERVAL_MS);
        return;
      }
      const attempt = new AbortController();
      const timeout = setTimeout(() => attempt.abort(), 2000);
      const signal = AbortSignal.any([lifetime.signal, attempt.signal]);
      let bitmap: ImageBitmap | undefined;
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
        if (response.status === 204) return;
        if (
          !response.ok ||
          response.headers.get("content-type") !== "image/jpeg" ||
          response.headers.get("x-m4-ip-camera-generation") !==
            String(generation) ||
          Number(response.headers.get("content-length")) > 2 * 1024 * 1024
        )
          throw Error();
        const frame = Number(response.headers.get("x-m4-ip-camera-frame"));
        if (!Number.isSafeInteger(frame) || frame <= counter) throw Error();
        const blob = await response.blob();
        if (blob.size > 2 * 1024 * 1024 || !blob.size) throw Error();
        if (lifetime.signal.aborted || attempt.signal.aborted) return;
        if (playout) {
          // Polling and observations follow received frames while presentation
          // runs independently. No decoder or bitmap waits inside this queue.
          counter = frame;
          lastFrame = Date.now();
          playout.enqueue(blob);
          observe();
          return;
        }
        bitmap = await decodeM4CameraBitmap(blob, signal, (input) => {
          pendingDecodes++;
          return Promise.resolve()
            .then(() => createImageBitmap(input))
            .finally(() => pendingDecodes--);
        });
        if (lifetime.signal.aborted || attempt.signal.aborted || !context)
          return;
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
        context.drawImage(bitmap, 0, 0);
        publish(bitmap.width, bitmap.height);
        bitmap.close();
        bitmap = undefined;
        counter = frame;
        lastFrame = Date.now();
        observe();
      } catch {
        /* Retain a fresh picture through a missed local request. */
      } finally {
        clearTimeout(timeout);
        attempt.abort();
        bitmap?.close();
        if (!lifetime.signal.aborted) {
          if (lastFrame > 0 && Date.now() - lastFrame >= 5000) clear();
          timer = setTimeout(
            () => void poll(),
            Math.max(0, FRAME_INTERVAL_MS - (performance.now() - started)),
          );
        }
      }
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
  }, [role, generation, sourceIdentity, onChange, delayMs]);
  return null;
}
