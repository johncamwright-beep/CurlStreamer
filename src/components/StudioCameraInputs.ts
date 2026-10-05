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
    generation: z.number(),
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
