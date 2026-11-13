"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { m4CameraHealthSchema } from "@/lib/m4-camera-input";

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
    connectionEnabled: z.boolean().optional(),
    zoom: z.number().min(1).max(4).optional(),
    health: m4CameraHealthSchema.optional(),
  })
  .strict();
export type StudioCameraInput = z.infer<typeof studioCameraInputSchema>;
const studioCameraRoleSchema = z.enum(["camera-home", "camera-away"]);
type StudioCameraRole = z.infer<typeof studioCameraRoleSchema>;
type StudioCameraInputs = Partial<Record<StudioCameraRole, StudioCameraInput>>;

export function useStudioCameraInputs(id?: string) {
  const [cameras, setCameras] = useState<StudioCameraInputs>({});
  useEffect(() => {
    setCameras({});
    const cameraEvents = z.object({
      gameId: z.literal(id ?? ""),
      cameras: z.partialRecord(studioCameraRoleSchema, studioCameraInputSchema),
    });
    const healthEvents = z.object({
      gameId: z.literal(id ?? ""),
      cameras: z.partialRecord(
        studioCameraRoleSchema,
        z.object({
          generation: z.number().int().nonnegative(),
          health: m4CameraHealthSchema.optional(),
        }),
      ),
    });
    const receive = (event: Event) => {
      const result = cameraEvents.safeParse((event as CustomEvent).detail);
      if (result.success)
        setCameras((current) => {
          const next = { ...result.data.cameras };
          for (const role of studioCameraRoleSchema.options) {
            const camera = next[role];
            const previous = current[role];
            if (camera && camera.generation === previous?.generation)
              next[role] = {
                ...camera,
                health: camera.health ?? previous.health,
              };
          }
          return next;
        });
    };
    const receiveHealth = (event: Event) => {
      const result = healthEvents.safeParse((event as CustomEvent).detail);
      if (result.success)
        setCameras((current) => {
          const next = { ...current };
          for (const role of studioCameraRoleSchema.options) {
            const camera = current[role];
            const sample = result.data.cameras[role];
            if (sample?.health && camera?.generation === sample.generation)
              next[role] = { ...camera, health: sample.health };
          }
          return next;
        });
    };
    window.addEventListener("studio-camera-inputs", receive);
    window.addEventListener("studio-local-health", receiveHealth);
    return () => {
      window.removeEventListener("studio-camera-inputs", receive);
      window.removeEventListener("studio-local-health", receiveHealth);
    };
  }, [id]);
  return cameras;
}

/** Acknowledges connection intent; fresh video is verified independently. */
export function cameraInputNativeConnection(
  id: string,
  cameraRole: StudioCameraRole,
  action: "connect-camera" | "disconnect-camera",
) {
  const native = (
    window as Window & {
      chrome?: { webview?: { postMessage(value: unknown): void } };
    }
  ).chrome?.webview;
  if (!native)
    return Promise.reject(
      Error("Open this game in Studio to connect its IP cameras."),
    );
  const nonce = crypto.randomUUID();
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("studio-camera-connection-result", receive);
    };
    const receive = (event: Event) => {
      const parsed = z
        .object({
          gameId: z.literal(id),
          cameraRole: z.literal(cameraRole),
          nonce: z.literal(nonce),
          ok: z.boolean(),
          connectionEnabled: z.boolean(),
          generation: z.number().int().nonnegative(),
          error: z.string().max(300).nullable().optional(),
        })
        .strict()
        .safeParse((event as CustomEvent).detail);
      if (!parsed.success) return;
      cleanup();
      if (
        parsed.data.ok &&
        parsed.data.connectionEnabled === (action === "connect-camera")
      )
        resolve(parsed.data.connectionEnabled);
      else
        reject(
          Error(
            parsed.data.error ||
              "Studio could not confirm the camera connection. Try again.",
          ),
        );
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(
        Error(
          "Studio did not confirm the camera connection. Check its status and try again.",
        ),
      );
    }, 12000);
    window.addEventListener("studio-camera-connection-result", receive);
    try {
      native.postMessage({ action, gameId: id, cameraRole, nonce });
    } catch {
      cleanup();
      reject(Error("Windows Studio is unavailable."));
    }
  });
}
export function cameraInputNativeAction(
  id: string,
  cameraRole: string,
  action: "configure-camera",
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
