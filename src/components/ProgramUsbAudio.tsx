"use client";

import { useEffect } from "react";
import { acquireProgramAudioOutput } from "@/lib/program-audio-output";

/** Receives Studio's local USB mix only inside the private OBS browser source. */
export function ProgramUsbAudio() {
  useEffect(() => {
    const output = acquireProgramAudioOutput();
    const context = output.context;
    const scheduled = new Set<AudioBufferSourceNode>();
    let generation = "",
      nextAt = 0,
      stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      requestController: AbortController | undefined;
    let scheduledFrames = 0,
      latestPeak = 0,
      latestRms = 0,
      lastReport = 0;
    let reportController: AbortController | undefined;
    const report = () => {
      if (stopped || reportController || performance.now() - lastReport < 500)
        return;
      lastReport = performance.now();
      reportController = new AbortController();
      const reportTimeout = setTimeout(() => reportController?.abort(), 500);
      void fetch("/camera", {
        signal: reportController.signal,
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "usb-audio-observe",
          contextState: context.state === "running" ? "running" : "suspended",
          scheduledFrames: Math.min(480_000, Math.max(0, scheduledFrames)),
          peak: Math.min(1, latestPeak),
          rms: Math.min(1, latestRms),
        }),
      })
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(reportTimeout);
          reportController = undefined;
        });
    };
    const flush = () => {
      nextAt = 0;
      for (const source of scheduled) {
        try {
          source.stop();
        } catch {
          // An already-ended source has nothing left to cancel.
        }
      }
      scheduled.clear();
      scheduledFrames = 0;
    };
    const poll = async () => {
      requestController = new AbortController();
      const timeout = setTimeout(() => requestController?.abort(), 500);
      try {
        const response = await fetch("/usb-audio", {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: requestController.signal,
        });
        if (stopped || requestController.signal.aborted) return;
        if (!response.ok && response.status !== 204) throw new Error();
        const currentGeneration =
          response.headers.get("x-m4-usb-audio-generation") ?? "";
        if (generation && currentGeneration !== generation) flush();
        generation = currentGeneration;
        const raw = await response.arrayBuffer();
        if (stopped || requestController.signal.aborted) return;
        if (
          raw.byteLength &&
          raw.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
        ) {
          const allSamples = new Float32Array(raw);
          // A delayed poll keeps the latest 150ms and discards stale sound.
          const input = allSamples.subarray(
            Math.max(0, allSamples.length - 48_000 * 0.15),
          );
          let square = 0;
          latestPeak = 0;
          for (const sample of input) {
            latestPeak = Math.max(latestPeak, Math.abs(sample));
            square += sample * sample;
          }
          latestRms = input.length ? Math.sqrt(square / input.length) : 0;
          const buffer = context.createBuffer(1, input.length, 48_000);
          buffer.copyToChannel(input, 0);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(output.input);
          source.onended = () => {
            if (scheduled.delete(source))
              scheduledFrames = Math.max(0, scheduledFrames - input.length);
          };
          const now = context.currentTime;
          if (nextAt > now + 0.15) flush();
          nextAt = Math.max(nextAt, now + 0.02);
          source.start(nextAt);
          nextAt += buffer.duration;
          scheduledFrames += input.length;
          scheduled.add(source);
        }
      } catch {
        // The program bridge is allowed to disappear while OBS is closing.
      } finally {
        clearTimeout(timeout);
        requestController = undefined;
        report();
        if (!stopped) timer = setTimeout(() => void poll(), 50);
      }
    };
    void context
      .resume()
      .then(() => {
        if (!stopped) void poll();
      })
      .catch(() => report());
    return () => {
      stopped = true;
      clearTimeout(timer);
      requestController?.abort();
      reportController?.abort();
      flush();
      output.release();
    };
  }, []);
  return null;
}
