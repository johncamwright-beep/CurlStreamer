import { z } from "zod";

/** Pinned FFmpeg keeps RTSP user information in a 128-byte buffer. */
export function rtspCredentialUserInfoLength(
  username: string,
  password: string,
) {
  const encodedLength = (value: string) =>
    new TextEncoder()
      .encode(value)
      .reduce(
        (length, byte) =>
          length +
          ((byte >= 65 && byte <= 90) ||
          (byte >= 97 && byte <= 122) ||
          (byte >= 48 && byte <= 57) ||
          [45, 46, 95, 126].includes(byte)
            ? 1
            : 3),
        0,
      );
  return encodedLength(username) + 1 + encodedLength(password);
}

/** Literal RFC1918 addresses only: no DNS lookup or URL parsing is needed. */
export const privateCameraHostSchema = z.string().refine((host) => {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host))
    return false;
  const octets = host.split(".").map(Number);
  return (
    octets.every((n) => n <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))
  );
}, "invalid_private_camera_host");

export const m4CameraInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("phone") }).strict(),
  z
    .object({
      kind: z.literal("tapo"),
      host: privateCameraHostSchema,
      port: z.literal(554).default(554),
      username: z
        .string()
        .min(1)
        .max(128)
        .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
      password: z
        .string()
        .min(1)
        .max(256)
        .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
      stream: z.enum(["stream1", "stream2"]).default("stream1"),
      rotation: z
        .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
        .default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rtsp"),
      host: privateCameraHostSchema,
      port: z.number().int().min(1).max(65535).default(554),
      username: z
        .string()
        .max(128)
        .refine((v) => !/[\u0000-\u001f\u007f]/.test(v))
        .default(""),
      password: z
        .string()
        .max(256)
        .refine((v) => !/[\u0000-\u001f\u007f]/.test(v))
        .default(""),
      path: z
        .string()
        .min(1)
        .max(1024)
        .startsWith("/")
        .refine((v) => !/[\u0000-\u001f\u007f\s#\\]/.test(v)),
      rotation: z
        .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
        .default(0),
    })
    .strict()
    .refine(
      (input) =>
        rtspCredentialUserInfoLength(input.username, input.password) <= 127,
      "invalid_camera_credentials_length",
    ),
]);
export type M4CameraInput = z.infer<typeof m4CameraInputSchema>;
export type M4CameraInputPhase =
  "idle" | "connecting" | "streaming" | "retrying" | "failed";
export type M4CameraInputError =
  | "runtime_missing"
  | "auth_failed"
  | "unavailable"
  | "invalid_pipe"
  | "stale_frames"
  | null;
export type M4CameraInputSnapshot = {
  kind: "phone" | "tapo" | "rtsp";
  host: string | null;
  stream: "stream1" | "stream2" | null;
  rotation: 0 | 90 | 180 | 270;
  configured: boolean;
  connectionEnabled: boolean;
  phase: M4CameraInputPhase;
  errorCode: M4CameraInputError;
  generation: number;
  zoom?: number;
};
export const m4CameraZoomSchema = z.number().min(1).max(4).multipleOf(0.1);
export const m4CameraInputSnapshotSchema = z
  .object({
    kind: z.enum(["phone", "tapo", "rtsp"]),
    host: privateCameraHostSchema.nullable(),
    stream: z.enum(["stream1", "stream2"]).nullable(),
    rotation: z.union([
      z.literal(0),
      z.literal(90),
      z.literal(180),
      z.literal(270),
    ]),
    configured: z.boolean(),
    connectionEnabled: z.boolean(),
    phase: z.enum(["idle", "connecting", "streaming", "retrying", "failed"]),
    errorCode: z
      .enum([
        "runtime_missing",
        "auth_failed",
        "unavailable",
        "invalid_pipe",
        "stale_frames",
      ])
      .nullable(),
    generation: z.number().int().nonnegative(),
    zoom: m4CameraZoomSchema.default(1),
  })
  .strict();
