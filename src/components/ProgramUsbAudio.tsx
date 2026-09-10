"use client";

import { useEffect } from "react";

/** Receives Studio's local USB mix only inside the private OBS browser source. */
export function ProgramUsbAudio() {
  useEffect(() => {
    const context = new AudioContext({ sampleRate: 48_000 });
    const gain = context.createGain();
    gain.gain.value = 0.5; // leave final program headroom for the phone feeds
    gain.connect(context.destination);
    const scheduled = new Set<AudioBufferSourceNode>();
    let generation = "",
      nextAt = 0,
      stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      requestController: AbortController | undefined;
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
          const buffer = context.createBuffer(1, input.length, 48_000);
          buffer.copyToChannel(input, 0);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(gain);
          source.onended = () => scheduled.delete(source);
          const now = context.currentTime;
          if (nextAt > now + 0.15) flush();
          nextAt = Math.max(nextAt, now + 0.02);
          source.start(nextAt);
          nextAt += buffer.duration;
          scheduled.add(source);
        }
      } catch {
        // The program bridge is allowed to disappear while OBS is closing.
      } finally {
        clearTimeout(timeout);
        requestController = undefined;
      }
      if (!stopped) timer = setTimeout(() => void poll(), 50);
    };
    void context
      .resume()
      .then(() => {
        if (!stopped) void poll();
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      clearTimeout(timer);
      requestController?.abort();
      flush();
      gain.disconnect();
      void context.close();
    };
  }, []);
  return null;
}
