import { useEffect } from "react";
import type { ProgramCameraRole } from "./ProgramCanvas";

/** Only mounted inside the private OBS renderer. Its destination is OBS's
 * rerouted browser audio, never the scorer's laptop speaker output. */
export function ProgramPhoneAudio({
  role,
  stream,
  enabled,
}: {
  role: ProgramCameraRole;
  stream?: MediaStream;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!stream || !enabled) return;
    const abort = new AbortController();
    const context = new AudioContext({ sampleRate: 48000 });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const gain = context.createGain();
    gain.gain.value = 0.5;
    gain.channelCount = 1;
    gain.channelCountMode = "explicit";
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    let pending = false;
    const report = async () => {
      if (pending || abort.signal.aborted) return;
      pending = true;
      try {
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
        await fetch("/camera", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]),
          body: JSON.stringify({
            action: "audio-observe",
            cameraRole: role,
            receiving,
            peak: receiving ? Math.min(1, peak) : 0,
            rms: receiving
              ? Math.min(1, Math.sqrt(square / samples.length))
              : 0,
          }),
        });
      } catch {
        /* Missing observations expire rather than showing stale levels. */
      } finally {
        pending = false;
      }
    };
    void report();
    const timer = setInterval(() => void report(), 500);
    return () => {
      abort.abort();
      clearInterval(timer);
      gain.gain.value = 0;
      source.disconnect();
      analyser.disconnect();
      gain.disconnect();
      void context.close();
    };
  }, [stream, enabled, role]);
  return null;
}
