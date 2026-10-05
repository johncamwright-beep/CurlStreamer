"use client";

import { useEffect } from "react";
import { decodeM4CameraBitmap } from "./m4-camera-image-browser";
import { m4RendererInstance } from "./m4-renderer-health-browser";
import { cameraAspect } from "../program-camera-layout";
import type { CameraRole } from "../m2-studio-protocol";

/** Only the private program renderer can fetch these uncredentialed loopback
 * paths. RTSP addresses and camera passwords never reach browser JavaScript. */
export function M4IpCameraTransport({
  role,
  generation,
  sourceIdentity,
  onChange,
}: {
  role: CameraRole;
  generation: number;
  sourceIdentity: string;
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
    const context = canvas.getContext("2d");
    let displayed = false;
    let publishedAspect: number | undefined;
    let counter = 0;
    let lastFrame = 0;
    // createImageBitmap cannot be cancelled. Leave room for recovery after one
    // stalled decode, but never accumulate unbounded decoder work on retries.
    let pendingDecodes = 0;
    const clear = () => {
      context?.clearRect(0, 0, canvas.width, canvas.height);
      displayed = false;
      onChange(role, { sourceIdentity, message: "Reconnecting IP camera…" });
    };
    const poll = async () => {
      if (pendingDecodes >= 2) {
        if (displayed && Date.now() - lastFrame >= 5000) clear();
        if (!lifetime.signal.aborted) timer = setTimeout(() => void poll(), 50);
        return;
      }
      const attempt = new AbortController();
      const timeout = setTimeout(() => attempt.abort(), 2000);
      let bitmap: ImageBitmap | undefined;
      try {
        const response = await fetch(
          `/ip-camera/${role}/frame?generation=${generation}&after=${counter}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.any([lifetime.signal, attempt.signal]),
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
        bitmap = await decodeM4CameraBitmap(
          blob,
          AbortSignal.any([lifetime.signal, attempt.signal]),
          (input) => {
            pendingDecodes++;
            return Promise.resolve()
              .then(() => createImageBitmap(input))
              .finally(() => pendingDecodes--);
          },
        );
        if (lifetime.signal.aborted || attempt.signal.aborted || !context)
          return;
        const aspect = cameraAspect(bitmap.width, bitmap.height);
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        bitmap = undefined;
        counter = frame;
        lastFrame = Date.now();
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
        await fetch("/camera", {
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
            verified: true,
            sourceGeneration: generation,
          }),
        });
      } catch {
        /* Retain a fresh picture through a missed local request. */
      } finally {
        clearTimeout(timeout);
        bitmap?.close();
        if (!lifetime.signal.aborted) {
          if (displayed && Date.now() - lastFrame >= 5000) clear();
          timer = setTimeout(() => void poll(), 50);
        }
      }
    };
    onChange(role, { sourceIdentity, message: "Connecting IP camera…" });
    void poll();
    return () => {
      lifetime.abort();
      clearTimeout(timer);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    };
  }, [role, generation, sourceIdentity, onChange]);
  return null;
}
