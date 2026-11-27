import { m4CameraInputSnapshotSchema } from "./m4-camera-input";
import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const measurement = z.number().finite().nonnegative();
const optionalCount = count.nullable();
const optionalMeasurement = measurement.nullable();

/** Allowlisted local measurements only. Unknown is null, never an invented zero. */
export const studioTroubleshootingSchema = z
  .object({
    version: z.literal(1),
    gameId: z.uuid(),
    capturedAt: count,
    cameras: z
      .array(
        z
          .object({
            role: z.enum(["camera-home", "camera-away"]),
            phase: z.enum([
              "idle",
              "connecting",
              "streaming",
              "retrying",
              "failed",
            ]),
            stream: z.enum(["stream1", "stream2"]).nullable(),
            transport: z.enum(["udp", "tcp"]).nullable(),
            sourceWidth: count.max(16384).nullable(),
            sourceHeight: count.max(16384).nullable(),
            receivedKbps: optionalMeasurement,
            receivedFps: measurement.max(240).nullable(),
            lastFrameAgeMs: optionalMeasurement,
            longestGapMs: optionalMeasurement,
            reconnects: optionalCount,
            decodeErrors: optionalCount,
            processingMs: optionalMeasurement,
            bufferMs: measurement.max(10000).nullable(),
            packetsLost: optionalCount,
          })
          .strip(),
      )
      .max(2),
    output: z
      .object({
        active: z.boolean().nullable(),
        receiving: z.boolean().nullable(),
        targetKbps: optionalMeasurement,
        sentKbps: optionalMeasurement,
        congestion: z.number().min(0).max(1).nullable(),
        droppedFrames: optionalCount,
        totalFrames: optionalCount,
        reconnects: optionalCount,
        adaptiveBitrate: z.boolean().nullable(),
      })
      .strip(),
    processing: z
      .object({
        renderFps: measurement.max(240).nullable(),
        renderMs: optionalMeasurement,
        renderSkippedFrames: optionalCount,
        encodeSkippedFrames: optionalCount,
        cpuPercent: measurement.max(100).nullable(),
        gpuPercent: measurement.max(100).nullable(),
      })
      .strip(),
    audio: z
      .object({
        running: z.boolean().nullable(),
        muted: z.boolean().nullable(),
        peak: measurement.max(1).nullable(),
        interruptions: optionalCount,
      })
      .strip(),
    network: z
      .object({
        connection: z.enum(["ethernet", "wifi", "other"]).nullable(),
        signalPercent: measurement.max(100).nullable(),
        packetsLost: optionalCount,
        interference: z.literal(null),
      })
      .strip(),
  })
  .strip();

export type StudioTroubleshooting = z.infer<typeof studioTroubleshootingSchema>;
export const troubleshootingEvent = "studio-troubleshooting-status";
export const troubleshootingSampleMs = 2000;
export const troubleshootingMaxSamples = 300;

/** Ten minutes at two-second intervals; isolate games and reject stale samples. */
export function retainTroubleshooting(
  history: StudioTroubleshooting[],
  sample: StudioTroubleshooting,
) {
  const last = history.at(-1);
  if (!last || last.gameId !== sample.gameId) return [sample];
  if (sample.capturedAt <= last.capturedAt) return history;
  const cutoff = sample.capturedAt - 10 * 60 * 1000;
  const recent = history.filter((item) => item.capturedAt >= cutoff);
  if (sample.capturedAt - last.capturedAt < troubleshootingSampleMs)
    return history;
  return [...recent, sample].slice(-troubleshootingMaxSamples);
}

export function troubleshootingExport(history: StudioTroubleshooting[]) {
  // Parse again so extra native fields, device names, URLs or keys cannot leak.
  const samples = history
    .slice(-troubleshootingMaxSamples)
    .map((sample) => studioTroubleshootingSchema.parse(sample));
  const gameId = samples.at(-1)?.gameId ?? null;
  return JSON.stringify(
    {
      version: 1,
      gameId,
      units: { bitrate: "kbps", delay: "milliseconds", congestion: "0–1" },
      notes:
        "Null means not measured. Frame drops and decode errors are not packet-loss or radio-interference measurements.",
      samples: samples.filter((sample) => sample.gameId === gameId),
    },
    null,
    2,
  );
}

export const localHealthSchema = z.object({
  gameId: z.uuid(),
  capturedAt: count,
  cameras: z.object({
    "camera-home": m4CameraInputSnapshotSchema,
    "camera-away": m4CameraInputSnapshotSchema,
  }),
  nativeHealth: z
    .object({
      capturedAt: count,
      targetKbps: measurement,
      sentKbps: measurement,
      congestion: measurement.max(1),
      droppedFrames: count,
      totalFrames: count,
      adaptiveBitrate: z.boolean(),
      renderFps: measurement.max(240),
      renderMs: measurement,
      renderSkippedFrames: count,
    })
    .nullable(),
});
export function localTroubleshooting(
  input: z.infer<typeof localHealthSchema>,
): StudioTroubleshooting {
  const native = input.nativeHealth;
  return {
    version: 1,
    gameId: input.gameId,
    capturedAt: input.capturedAt,
    cameras: (["camera-home", "camera-away"] as const).map((role) => {
      const camera = input.cameras[role],
        health = camera.health,
        source = health?.native;
      return {
        role,
        phase: camera.phase,
        stream: camera.stream,
        transport: source?.transport ?? null,
        sourceWidth: source?.sourceWidth ?? null,
        sourceHeight: source?.sourceHeight ?? null,
        receivedKbps: source?.receivedKbps ?? null,
        receivedFps: health?.receivedFps ?? null,
        lastFrameAgeMs: health?.lastFrameAgeMs ?? null,
        longestGapMs: health?.longestGapMs ?? null,
        reconnects: health?.reconnects ?? null,
        decodeErrors: source?.decodeErrors ?? null,
        processingMs: source?.processingMs ?? null,
        bufferMs: source?.bufferMs ?? null,
        packetsLost: null,
      };
    }),
    output: {
      active: null,
      receiving: null,
      targetKbps: native?.targetKbps ?? null,
      sentKbps: native?.sentKbps ?? null,
      congestion: native?.congestion ?? null,
      droppedFrames: native?.droppedFrames ?? null,
      totalFrames: native?.totalFrames ?? null,
      reconnects: null,
      adaptiveBitrate: native?.adaptiveBitrate ?? null,
    },
    processing: {
      renderFps: native?.renderFps ?? null,
      renderMs: native?.renderMs ?? null,
      renderSkippedFrames: native?.renderSkippedFrames ?? null,
      encodeSkippedFrames: null,
      cpuPercent: null,
      gpuPercent: null,
    },
    audio: { running: null, muted: null, peak: null, interruptions: null },
    network: {
      connection: null,
      signalPercent: null,
      packetsLost: null,
      interference: null,
    },
  };
}
