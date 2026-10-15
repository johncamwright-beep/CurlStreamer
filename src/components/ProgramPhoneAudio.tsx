import { useEffect, useRef } from "react";
import { m4RendererInstance } from "@/lib/providers/m4-renderer-health-browser";
import type { ProgramCameraRole } from "./ProgramCanvas";
import { acquireProgramAudioOutput } from "@/lib/program-audio-output";
import { createRemoteAudioPlayout } from "@/lib/remote-audio-playout";

/** Only mounted inside the private OBS renderer. Its destination is OBS's
 * rerouted browser audio, never the scorer's laptop speaker output. */
export function ProgramPhoneAudio({
  role,
  stream,
  enabled,
  volume = 1,
  sourceGeneration,
  delayMs = 0,
}: {
  role: ProgramCameraRole;
  stream?: MediaStream;
  enabled: boolean;
  volume?: number;
  sourceGeneration?: number;
  delayMs?: number;
}) {
  const delayRef = useRef<DelayNode | null>(null);
  const delayValue = useRef(delayMs);
  delayValue.current = delayMs;
  useEffect(() => {
    const delay = delayRef.current;
    if (delay)
      delay.delayTime.setTargetAtTime(
        Math.max(0, Math.min(5000, delayMs)) / 1000,
        delay.context.currentTime,
        0.03,
      );
  }, [delayMs]);
  const gainRef = useRef<GainNode | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  useEffect(() => {
    const gain = gainRef.current;
    if (gain) gain.gain.setTargetAtTime(volume, gain.context.currentTime, 0.02);
  }, [volume]);
  useEffect(() => {
    if (!stream || !enabled) return;
    const abort = new AbortController();
    const output = acquireProgramAudioOutput();
    const { context } = output;
    const playout = createRemoteAudioPlayout(stream);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const gain = context.createGain();
    const delay = context.createDelay(5);
    delay.delayTime.value =
      Math.max(0, Math.min(5000, delayValue.current)) / 1000;
    delayRef.current = delay;
    // Phone sources join the renderer's one shared output graph. That graph
    // owns speech protection and the final combined limiter with USB audio.
    gain.gain.value = volumeRef.current;
    gainRef.current = gain;
    gain.channelCount = 1;
    gain.channelCountMode = "explicit";
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(delay);
    delay.connect(output.input);
    const samples = new Float32Array(analyser.fftSize);
    let pending = false;
    const report = async () => {
      if (pending || abort.signal.aborted) return;
      pending = true;
      const attempt = new AbortController();
      const timeout = setTimeout(() => attempt.abort(), 2000);
      const signal = AbortSignal.any([abort.signal, attempt.signal]);
      try {
        void playout.start();
        if (context.state === "suspended") await context.resume();
        analyser.getFloatTimeDomainData(samples);
        let peak = 0,
          square = 0;
        for (const sample of samples) {
          peak = Math.max(peak, Math.abs(sample));
          square += sample * sample;
        }
        const receiving =
          context.state === "running" &&
          stream
            .getAudioTracks()
            .some((track) => track.readyState === "live" && !track.muted);
        const observation = await fetch("/camera", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            action: "audio-observe",
            rendererInstance: m4RendererInstance(),
            cameraRole: role,
            sourceGeneration,
            receiving,
            peak: receiving ? Math.min(1, peak) : 0,
            rms: receiving
              ? Math.min(1, Math.sqrt(square / samples.length))
              : 0,
          }),
        });
        await observation.text();
      } catch {
        /* Missing observations expire rather than showing stale levels. */
      } finally {
        clearTimeout(timeout);
        attempt.abort();
        pending = false;
      }
    };
    void report();
    const timer = setInterval(() => void report(), 500);
    return () => {
      abort.abort();
      clearInterval(timer);
      playout.stop();
      gain.gain.value = 0;
      source.disconnect();
      analyser.disconnect();
      gain.disconnect();
      delay.disconnect();
      delayRef.current = null;
      gainRef.current = null;
      output.release();
    };
  }, [stream, enabled, role, sourceGeneration]);
  return null;
}
