"use client";

import { useEffect } from "react";
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
      frameUrl?: string;
      aspect?: number;
      sourceIdentity: string;
      message: string;
    },
  ): void;
}) {
  useEffect(() => {
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let displayed: string | undefined;
    let counter = 0;
    let lastFrame = 0;
    const clear = () => {
      if (displayed) URL.revokeObjectURL(displayed);
      displayed = undefined;
      onChange(role, { sourceIdentity, message: "Reconnecting IP camera…" });
    };
    const poll = async () => {
      const attempt = new AbortController();
      const timeout = setTimeout(() => attempt.abort(), 2000);
      let next: string | undefined;
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
        next = URL.createObjectURL(blob);
        const image = new Image();
        image.src = next;
        await image.decode();
        if (lifetime.signal.aborted || attempt.signal.aborted) return;
        const previous = displayed;
        displayed = next;
        next = undefined;
        counter = frame;
        lastFrame = Date.now();
        onChange(role, {
          sourceIdentity,
          frameUrl: displayed,
          aspect: cameraAspect(image.naturalWidth, image.naturalHeight),
          message: "Receiving IP video",
        });
        if (previous) URL.revokeObjectURL(previous);
        await fetch("/camera", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          signal: AbortSignal.any([lifetime.signal, attempt.signal]),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "observe",
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
        if (next) URL.revokeObjectURL(next);
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
      if (displayed) URL.revokeObjectURL(displayed);
    };
  }, [role, generation, sourceIdentity, onChange]);
  return null;
}
