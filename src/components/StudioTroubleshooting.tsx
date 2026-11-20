"use client";

import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { StudioOverlay } from "./StudioOverlay";
import {
  retainTroubleshooting,
  localHealthSchema,
  localTroubleshooting,
  studioTroubleshootingSchema,
  troubleshootingEvent,
  troubleshootingExport,
  type StudioTroubleshooting as Snapshot,
} from "@/lib/studio-troubleshooting";

const value = (number: number | null, unit = "") =>
  number === null
    ? "Not measured"
    : `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
const yesNo = (flag: boolean | null) =>
  flag === null ? "Not measured" : flag ? "Yes" : "No";

function Measurements({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map(([label, text]) => (
        <div key={label} className="rounded border border-slate-600 p-3">
          <dt className="text-sm text-slate-300">{label}</dt>
          <dd className="m-0 font-semibold">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Observes existing local Studio telemetry; never polls the cloud or starts media. */
export function StudioTroubleshooting({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [stale, setStale] = useState(false);
  const history = useRef<Snapshot[]>([]);
  const receivedAt = useRef(0);
  useEffect(() => {
    history.current = [];
    receivedAt.current = 0;
    setLatest(null);
    setStale(false);
    let audio: {
      at: number;
      running: boolean;
      muted: boolean;
      peak: number;
    } | null = null;
    let output: { at: number; active: boolean; receiving: boolean } | null =
      null;
    const onAudio = (event: Event) => {
      const parsed = z
        .object({
          gameId: z.uuid(),
          running: z.boolean(),
          allMuted: z.boolean(),
          channels: z
            .array(z.object({ peak: z.number().min(0).max(1) }))
            .max(32),
        })
        .safeParse((event as CustomEvent).detail);
      if (parsed.success && parsed.data.gameId === gameId)
        audio = {
          at: Date.now(),
          running: parsed.data.running,
          muted: parsed.data.allMuted,
          peak: Math.max(0, ...parsed.data.channels.map((c) => c.peak)),
        };
    };
    const onOutput = (event: Event) => {
      const parsed = z
        .object({
          gameId: z.uuid(),
          outputActive: z.boolean(),
          receiving: z.boolean(),
        })
        .safeParse((event as CustomEvent).detail);
      if (parsed.success && parsed.data.gameId === gameId)
        output = {
          at: Date.now(),
          active: parsed.data.outputActive,
          receiving: parsed.data.receiving,
        };
    };
    const onLocal = (event: Event) => {
      const parsed = localHealthSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || parsed.data.gameId !== gameId) return;
      const sample = localTroubleshooting(parsed.data);
      if (audio && Date.now() - audio.at < 10000)
        sample.audio = {
          running: audio.running,
          muted: audio.muted,
          peak: audio.peak,
          interruptions: null,
        };
      if (output && Date.now() - output.at < 10000) {
        sample.output.active = output.active;
        sample.output.receiving = output.receiving ? true : null;
      }
      receive(new CustomEvent(troubleshootingEvent, { detail: sample }));
    };
    const receive = (event: Event) => {
      const parsed = studioTroubleshootingSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (!parsed.success || parsed.data.gameId !== gameId) return;
      if (
        history.current.at(-1) &&
        parsed.data.capturedAt < history.current.at(-1)!.capturedAt
      )
        return;
      receivedAt.current = Date.now();
      history.current = retainTroubleshooting(history.current, parsed.data);
      setLatest(parsed.data);
      setStale(false);
    };
    window.addEventListener("studio-local-health", onLocal);
    window.addEventListener("studio-usb-status", onAudio);
    window.addEventListener("studio-youtube-status", onOutput);
    window.addEventListener(troubleshootingEvent, receive);
    return () => {
      window.removeEventListener(troubleshootingEvent, receive);
      window.removeEventListener("studio-local-health", onLocal);
      window.removeEventListener("studio-usb-status", onAudio);
      window.removeEventListener("studio-youtube-status", onOutput);
    };
  }, [gameId]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(
      () =>
        setStale(
          receivedAt.current > 0 && Date.now() - receivedAt.current > 10000,
        ),
      2000,
    );
    return () => clearInterval(timer);
  }, [open]);
  function download() {
    const url = URL.createObjectURL(
      new Blob([troubleshootingExport(history.current)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `curlstreamer-troubleshooting-${gameId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary min-h-11"
        onClick={() => setOpen(true)}
      >
        Troubleshooting
      </button>
      <StudioOverlay
        title="Troubleshooting"
        open={open}
        onClose={() => setOpen(false)}
      >
        <p role="status">
          {!latest
            ? "Waiting for local Studio measurements. An updated Studio is required."
            : stale
              ? "Measurements have stopped updating. These are the last received values."
              : `Updated ${new Date(latest.capturedAt).toLocaleTimeString()}`}
        </p>
        <button
          type="button"
          className="btn min-h-11"
          disabled={!history.current.length}
          onClick={download}
        >
          Save troubleshooting report
        </button>
        <p className="text-sm text-slate-300">
          Up to ten minutes of local measurements. Frame drops and decoding
          errors are not packet-loss or radio-interference measurements.
        </p>
        {latest && (
          <div className="space-y-5">
            {latest.cameras.map((camera) => (
              <section key={camera.role}>
                <h3>
                  {camera.role === "camera-home" ? "Camera 1" : "Camera 2"} ·{" "}
                  {camera.phase}
                </h3>
                <Measurements
                  rows={[
                    [
                      "Source resolution",
                      camera.sourceWidth && camera.sourceHeight
                        ? `${camera.sourceWidth} × ${camera.sourceHeight}`
                        : "Not measured",
                    ],
                    ["Selected stream", camera.stream ?? "Not measured"],
                    [
                      "Transport",
                      camera.transport?.toUpperCase() ?? "Not measured",
                    ],
                    [
                      "Received video bitrate",
                      value(camera.receivedKbps, " kbps"),
                    ],
                    ["Delivered frame rate", value(camera.receivedFps, " fps")],
                    ["Last frame age", value(camera.lastFrameAgeMs, " ms")],
                    ["Longest frame gap", value(camera.longestGapMs, " ms")],
                    ["Reconnects", value(camera.reconnects)],
                    ["Decoding errors", value(camera.decodeErrors)],
                    [
                      "Frame processing time",
                      value(camera.processingMs, " ms"),
                    ],
                    ["Buffer delay", value(camera.bufferMs, " ms")],
                    ["Lost network packets", value(camera.packetsLost)],
                  ]}
                />
              </section>
            ))}
            <section>
              <h3>YouTube output</h3>
              <p className="text-sm">
                Adaptive bitrate prioritizes smooth video when upload capacity
                drops. Recordings and replays share the adjusted video quality.
              </p>
              <Measurements
                rows={[
                  ["Local sender active", yesNo(latest.output.active)],
                  [
                    "YouTube reception confirmed",
                    yesNo(latest.output.receiving),
                  ],
                  [
                    "Target video bitrate",
                    value(latest.output.targetKbps, " kbps"),
                  ],
                  [
                    "Actual upload bitrate",
                    value(latest.output.sentKbps, " kbps"),
                  ],
                  [
                    "Output congestion",
                    value(
                      latest.output.congestion === null
                        ? null
                        : latest.output.congestion * 100,
                      "%",
                    ),
                  ],
                  ["Output frames dropped", value(latest.output.droppedFrames)],
                  ["Output frames total", value(latest.output.totalFrames)],
                  ["Output reconnects", value(latest.output.reconnects)],
                  [
                    "Adaptive bitrate enabled",
                    yesNo(latest.output.adaptiveBitrate),
                  ],
                ]}
              />
            </section>
            <section>
              <h3>Laptop processing</h3>
              <Measurements
                rows={[
                  [
                    "Rendering frame rate",
                    value(latest.processing.renderFps, " fps"),
                  ],
                  ["Rendering time", value(latest.processing.renderMs, " ms")],
                  [
                    "Frames skipped during rendering",
                    value(latest.processing.renderSkippedFrames),
                  ],
                  [
                    "Frames skipped during encoding",
                    value(latest.processing.encodeSkippedFrames),
                  ],
                  ["CPU load", value(latest.processing.cpuPercent, "%")],
                  ["GPU load", value(latest.processing.gpuPercent, "%")],
                ]}
              />
            </section>
            <section>
              <h3>Microphone capture</h3>
              <Measurements
                rows={[
                  ["Capture running", yesNo(latest.audio.running)],
                  ["All microphones muted", yesNo(latest.audio.muted)],
                  [
                    "Input peak",
                    latest.audio.peak === null
                      ? "Not measured"
                      : latest.audio.peak === 0
                        ? "Silent"
                        : `${(20 * Math.log10(latest.audio.peak)).toFixed(1)} dBFS`,
                  ],
                  ["Capture interruptions", value(latest.audio.interruptions)],
                ]}
              />
            </section>
            <section>
              <h3>Network</h3>
              <Measurements
                rows={[
                  [
                    "Active connection",
                    latest.network.connection ?? "Not measured",
                  ],
                  [
                    "Laptop Wi-Fi signal",
                    value(latest.network.signalPercent, "%"),
                  ],
                  ["Lost network packets", value(latest.network.packetsLost)],
                  ["Radio interference", "Not measured"],
                ]}
              />
              <p className="text-sm">
                Laptop Wi-Fi signal does not measure the cameras’ signal or
                prove interference.
              </p>
            </section>
          </div>
        )}
      </StudioOverlay>
    </>
  );
}
