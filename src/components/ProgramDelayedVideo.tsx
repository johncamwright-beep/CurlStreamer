import { useEffect, useRef } from "react";
import { cameraAspect } from "@/lib/program-camera-layout";
import { createProgramVideoPlayout } from "@/lib/providers/program-video-playout-browser";

/** Phone video retains its complete frame. Only compressed JPEGs are retained
 * during a negative mic correction; capture and presentation run independently. */
export function ProgramDelayedVideo({
  stream,
  onAspect,
  delayMs = 0,
}: {
  stream?: MediaStream;
  onAspect: (aspect: number) => void;
  delayMs?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onAspectRef = useRef(onAspect);
  onAspectRef.current = onAspect;
  const delayed = delayMs > 0;

  const reportAspect = (video: HTMLVideoElement) => {
    const aspect = cameraAspect(video.videoWidth, video.videoHeight);
    if (aspect) onAspectRef.current(aspect);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !stream || !delayed) return;
    let stopped = false;
    let encoding = false;
    let lastVideoTime = -Infinity;
    let timer: ReturnType<typeof setTimeout>;
    const capture = document.createElement("canvas");
    const context = capture.getContext("2d");
    const playout = createProgramVideoPlayout({
      canvas,
      delayMs,
      onFrame: (width, height) => {
        const aspect = cameraAspect(width, height);
        if (aspect) onAspectRef.current(aspect);
      },
    });
    const poll = () => {
      if (stopped) return;
      const now = performance.now();
      if (
        !encoding &&
        context &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        if (capture.width !== video.videoWidth)
          capture.width = video.videoWidth;
        if (capture.height !== video.videoHeight)
          capture.height = video.videoHeight;
        try {
          context.drawImage(video, 0, 0);
          encoding = true;
          capture.toBlob(
            (blob) => {
              encoding = false;
              if (!stopped && blob) playout.enqueue(blob, now);
            },
            "image/jpeg",
            0.9,
          );
        } catch {
          encoding = false;
          /* Unsupported capture skips a picture; it never displays live video
           * early while the selected delay is active. */
        }
      }
      // Account for capture work and round up the browser timer. Checking a
      // 33.333ms gate after a timer floored to 33ms halves the capture cadence.
      timer = setTimeout(
        poll,
        Math.max(1, Math.ceil(1000 / 30 - (performance.now() - now))),
      );
    };
    void video.play().catch(() => undefined);
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      playout.stop();
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      capture.width = 0;
      capture.height = 0;
    };
  }, [stream, delayed, delayMs]);

  return (
    <>
      <video
        className="portrait-camera-video"
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label="Direct camera"
        aria-hidden={delayed || undefined}
        onResize={(event) => reportAspect(event.currentTarget)}
        onLoadedMetadata={(event) => reportAspect(event.currentTarget)}
        style={{
          objectFit: "contain",
          visibility: delayed ? "hidden" : "visible",
        }}
      />
      {delayed && (
        <canvas
          ref={canvasRef}
          className="portrait-camera-video"
          role="img"
          aria-label="Direct camera"
          style={{ objectFit: "contain" }}
        />
      )}
    </>
  );
}
