"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

export const studioCameraInputSchema = z
  .object({
    kind: z.enum(["phone", "tapo", "rtsp"]),
    host: z.string().nullable().optional(),
    stream: z.enum(["stream1", "stream2"]).nullable().optional(),
    rotation: z
      .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
      .optional(),
    configured: z.boolean(),
    phase: z.string(),
    errorCode: z.string().nullable().optional(),
    generation: z.number().int().nonnegative(),
    zoom: z.number().min(1).max(4).optional(),
  })
  .strict();
export type StudioCameraInput = z.infer<typeof studioCameraInputSchema>;
export function useStudioCameraInputs(id?: string) {
  const [cameras, setCameras] = useState<Record<string, StudioCameraInput>>({});
  useEffect(() => {
    setCameras({});
    const receive = (event: Event) => {
      const result = z
        .object({
          gameId: z.literal(id ?? ""),
          cameras: z.partialRecord(
            z.enum(["camera-home", "camera-away"]),
            studioCameraInputSchema,
          ),
        })
        .safeParse((event as CustomEvent).detail);
      if (result.success) setCameras(result.data.cameras);
    };
    window.addEventListener("studio-camera-inputs", receive);
    return () => window.removeEventListener("studio-camera-inputs", receive);
  }, [id]);
  return cameras;
}
export function cameraInputNativeAction(
  id: string,
  cameraRole: string,
  action: "configure-camera" | "reconnect-camera",
) {
  const native = (
    window as Window & {
      chrome?: { webview?: { postMessage: (value: unknown) => void } };
    }
  ).chrome?.webview;
  native?.postMessage({ action, gameId: id, cameraRole });
}

/** Local source control: never sends credentials or a cloud game action. */
export function cameraInputNativeZoom(
  gameId: string,
  cameraRole: "camera-home" | "camera-away",
  generation: number,
  value: number,
): Promise<number> {
  const native = (
    window as Window & {
      chrome?: { webview?: { postMessage: (value: unknown) => void } };
    }
  ).chrome?.webview;
  if (!native)
    return Promise.reject(
      Error("Open this game in Studio to adjust IP camera zoom."),
    );
  const nonce = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("studio-camera-zoom-result", receive);
    };
    const receive = (event: Event) => {
      const result = z
        .object({
          gameId: z.literal(gameId),
          cameraRole: z.literal(cameraRole),
          generation: z.literal(generation),
          nonce: z.literal(nonce),
          ok: z.boolean(),
          value: z.number().min(1).max(4).optional(),
          error: z.string().optional(),
        })
        .strict()
        .safeParse((event as CustomEvent).detail);
      if (!result.success) return;
      cleanup();
      if (result.data.ok && result.data.value !== undefined)
        resolve(result.data.value);
      else reject(Error("Could not change IP camera zoom. Try again."));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("Studio did not confirm IP camera zoom. Try again."));
    }, 8000);
    window.addEventListener("studio-camera-zoom-result", receive);
    try {
      native.postMessage({
        action: "zoom-camera",
        gameId,
        cameraRole,
        generation,
        value,
        nonce,
      });
    } catch {
      cleanup();
      reject(Error("Could not change IP camera zoom. Try again."));
    }
  });
}
