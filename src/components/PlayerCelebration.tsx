"use client";
import React, { useEffect, useRef, useState } from "react";
import type { CelebrationCue } from "@/lib/player-celebrations";
import { getCelebrationProgress } from "@/lib/player-celebrations";
import { acquireProgramAudioOutput } from "@/lib/program-audio-output";
import {
  LIGHTSABER_VIDEO,
  lightsaberFrameAt,
  lightsaberHeadTransforms,
  type LightsaberHeadTransform,
} from "@/lib/lightsaber-compositor";
import foreground from "@/lib/lightsaber-foreground.json";
import {
  CAT_DANCE_VIDEO,
  catDanceFrameAt,
  catDanceHeadTransforms,
} from "@/lib/cat-dance-compositor";
import { getCelebrationTemplate } from "@/lib/player-celebrations";
import {
  CELEBRATION_SQUARE_SIZE,
  celebrationSquareCrop,
} from "@/lib/celebration-square";
const VIDEOS = { lightsaber: LIGHTSABER_VIDEO, "cat-dance": CAT_DANCE_VIDEO };

const MAX_START_LATENESS_MS = 1000;
let foregroundImages: Promise<HTMLImageElement[]> | undefined;
const completeVideoUrls = new Map<string, Promise<string>>();
function loadCompleteVideoUrl(src: string) {
  const existing = completeVideoUrls.get(src);
  if (existing) return existing;
  const pending = fetch(src, {
    credentials: "same-origin",
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) throw Error("Celebration video unavailable");
      const blob = await response.blob();
      if (blob.size === 0 || blob.size > 32 * 1024 * 1024)
        throw Error("Invalid celebration video");
      return URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));
    })
    .catch((error) => {
      completeVideoUrls.delete(src);
      throw error;
    });
  completeVideoUrls.set(src, pending);
  return pending;
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const timer = setTimeout(
      () => reject(Error("Celebration image timed out")),
      6000,
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(Error("Celebration image unavailable"));
    };
    image.src = src;
  });
}
function loadForeground() {
  return (foregroundImages ??= Promise.all(
    foreground.sheets.map(loadImage),
  ).catch((error) => {
    foregroundImages = undefined;
    throw error;
  }));
}
function waitForVideo(video: HTMLVideoElement, event: "loadeddata" | "seeked") {
  if (event === "loadeddata" && video.readyState >= 2) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, loaded);
      video.removeEventListener("error", failed);
      error ? reject(error) : resolve();
    };
    const loaded = () => finish(),
      failed = () => finish(Error("Celebration video unavailable"));
    const timer = setTimeout(
      () => finish(Error("Celebration video timed out")),
      6000,
    );
    video.addEventListener(event, loaded, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

/** A seeked event can precede decoded presentation; never paint a stale base frame. */
async function seekToVideoTime(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) <= 0.005) return;
  if (typeof video.requestVideoFrameCallback !== "function") {
    const sought = waitForVideo(video, "seeked");
    video.currentTime = time;
    await sought;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let callback = 0;
    const timeout = setTimeout(() => {
      video.cancelVideoFrameCallback(callback);
      reject(Error("Celebration frame was not decoded"));
    }, 6000);
    const presented = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (Math.abs(metadata.mediaTime - time) < 1 / 30 + 0.001) {
        clearTimeout(timeout);
        resolve();
      } else callback = video.requestVideoFrameCallback(presented);
    };
    callback = video.requestVideoFrameCallback(presented);
    video.currentTime = time;
  });
}

async function preloadCompleteVideo(video: HTMLVideoElement) {
  // src is assigned only after the entire source file has downloaded. Browser
  // buffered ranges can omit leading audio padding even for a complete file.
  await waitForVideo(video, "loadeddata");
}
/** Trim alpha padding so every prepared head uses the approved proportional fit. */
export function trimCelebrationHead(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  if (
    !canvas.width ||
    !canvas.height ||
    canvas.width * canvas.height > 4_000_000
  )
    throw Error("Invalid prepared head dimensions");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Canvas unavailable");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width,
    top = canvas.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (rgba[(y * canvas.width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left || bottom < top) throw Error("The prepared head is empty");
  const cropped = document.createElement("canvas");
  cropped.width = right - left + 1;
  cropped.height = bottom - top + 1;
  cropped
    .getContext("2d")!
    .drawImage(
      canvas,
      left,
      top,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height,
    );
  return cropped;
}
export function drawCelebrationHead(
  context: CanvasRenderingContext2D,
  head: CanvasImageSource,
  transform: LightsaberHeadTransform,
) {
  context.save();
  context.translate(transform.cx, transform.chinY);
  context.rotate(transform.rotation);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    head,
    -transform.width / 2,
    -transform.height,
    transform.width,
    transform.height,
  );
  context.restore();
}
/** Base image, proportionate chin-anchored head, then original foreground blades/arm. */
export function drawLightsaberFrame(
  context: CanvasRenderingContext2D,
  video: CanvasImageSource,
  head: CanvasImageSource,
  transform: LightsaberHeadTransform,
  atlases: CanvasImageSource[],
  frame: number,
) {
  context.clearRect(0, 0, 1440, 1080);
  context.drawImage(video, 0, 0, 1440, 1080);
  drawCelebrationHead(context, head, transform);
  const patch = foreground.frames[frame];
  if (patch)
    context.drawImage(
      atlases[patch.sheet],
      patch.x,
      patch.y,
      patch.width,
      patch.height,
      patch.sourceX,
      patch.sourceY,
      patch.width,
      patch.height,
    );
}

type ProgramOutput = ReturnType<typeof acquireProgramAudioOutput>;
type AudioRoute = {
  output: ProgramOutput;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};
export interface PlayerCelebrationProps {
  cue: CelebrationCue | null;
  nativeAudio?: boolean;
  onReady?: () => void;
  onStart?: () => boolean | void;
  onError?: (message: string) => void;
}
/** One actual source clip; decoded video time selects the matching tracked head frame. */
export function PlayerCelebration({
  cue,
  nativeAudio = false,
  onReady,
  onStart,
  onError,
}: PlayerCelebrationProps) {
  const templateId = cue?.templateId ?? "lightsaber";
  const descriptor = VIDEOS[templateId];
  const videoRef = useRef<HTMLVideoElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioRoute | null>(null);
  const callbacks = useRef({ onReady, onStart, onError });
  callbacks.current = { onReady, onStart, onError };
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // Warm the dedicated stream output. Ordinary pages and silent previews
    // load on demand instead of downloading every clip before they are used.
    if (nativeAudio) {
      void loadForeground().catch(() => undefined);
      for (const descriptor of Object.values(VIDEOS))
        void loadCompleteVideoUrl(descriptor.src).catch(() => undefined);
    }
    const video = videoRef.current;
    return () => {
      video?.pause();
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        audio.gain.gain.value = 0;
        audio.source.disconnect();
        audio.gain.disconnect();
        audio.output.release();
      }
    };
  }, [nativeAudio]);
  useEffect(() => {
    setVisible(false);
    const video = videoRef.current,
      canvas = canvasRef.current;
    if (!video || !canvas || !cue?.headshotUrl || cue.expiresAt <= Date.now())
      return;
    video.dataset.celebrationStatus = "preloading";
    delete video.dataset.celebrationError;
    let cancelled = false,
      finished = false,
      frameCallback = 0,
      animationFrame = 0;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      finished = true;
      video.dataset.celebrationStatus = "stopped";
      video.pause();
      if (audioRef.current) audioRef.current.gain.gain.value = 0;
      setVisible(false);
    };
    const fail = (error: unknown) => {
      if (cancelled) return;
      stop();
      video.dataset.celebrationError =
        error instanceof Error ? error.message : "Celebration could not play";
      callbacks.current.onError?.(
        error instanceof Error ? error.message : "Celebration could not play",
      );
    };
    const context = canvas.getContext("2d");
    if (!context) {
      fail(Error("Canvas unavailable"));
      return;
    }
    const prepare = async () => {
      const [image, atlases, url] = await Promise.all([
        loadImage(cue.headshotUrl!),
        templateId === "lightsaber" ? loadForeground() : Promise.resolve([]),
        loadCompleteVideoUrl(descriptor.src),
      ]);
      if (cancelled) return;
      if (video.src !== url) {
        video.src = url;
        video.load();
      }
      await preloadCompleteVideo(video);
      if (cancelled) return;
      const head = trimCelebrationHead(image),
        transforms = (
          templateId === "lightsaber"
            ? lightsaberHeadTransforms
            : catDanceHeadTransforms
        )(head.width / head.height);
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = descriptor.width;
      sourceCanvas.height = descriptor.height;
      const sourceContext = sourceCanvas.getContext("2d");
      if (!sourceContext) throw Error("Canvas unavailable");
      video.dataset.celebrationStatus = "ready";
      callbacks.current.onReady?.();
      const paint = (time: number) => {
        if (cancelled || finished) return;
        if (getCelebrationProgress(cue, Date.now()) === null) {
          stop();
          return;
        }
        const frame = (
          templateId === "lightsaber" ? lightsaberFrameAt : catDanceFrameAt
        )(time);
        canvas.dataset.frame = String(frame);
        if (templateId === "lightsaber")
          drawLightsaberFrame(
            sourceContext,
            video,
            head,
            transforms[frame],
            atlases,
            frame,
          );
        else {
          sourceContext.clearRect(0, 0, descriptor.width, descriptor.height);
          sourceContext.drawImage(
            video,
            0,
            0,
            descriptor.width,
            descriptor.height,
          );
          drawCelebrationHead(sourceContext, head, transforms[frame]);
        }
        const crop = celebrationSquareCrop(templateId, transforms[frame]);
        context.clearRect(
          0,
          0,
          CELEBRATION_SQUARE_SIZE,
          CELEBRATION_SQUARE_SIZE,
        );
        context.drawImage(
          sourceCanvas,
          crop.x,
          crop.y,
          crop.size,
          crop.size,
          0,
          0,
          CELEBRATION_SQUARE_SIZE,
          CELEBRATION_SQUARE_SIZE,
        );
      };
      const start = async () => {
        if (cancelled) return;
        video.dataset.celebrationStatus = "starting";
        const elapsed = Date.now() - cue.startedAt;
        if (
          elapsed > MAX_START_LATENESS_MS ||
          getCelebrationProgress(cue, Date.now()) === null
        ) {
          stop();
          return;
        }
        if (nativeAudio) {
          let route = audioRef.current;
          if (!route) {
            const output = acquireProgramAudioOutput();
            const source = output.context.createMediaElementSource(video),
              gain = output.context.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(output.input);
            route = { output, source, gain };
            audioRef.current = route;
          }
          await Promise.race([
            route.output.context.resume(),
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
          if (cancelled) return;
          if (route.output.context.state !== "running")
            throw Error("Program audio is not ready");
        }
        const offset = Math.max(0, (Date.now() - cue.startedAt) / 1000);
        if (offset * 1000 > MAX_START_LATENESS_MS) {
          stop();
          return;
        }
        await seekToVideoTime(video, offset);
        if (cancelled || cue.expiresAt <= Date.now()) return;
        if (callbacks.current.onStart?.() === false) {
          stop();
          return;
        }
        video.muted = !nativeAudio;
        if (audioRef.current)
          audioRef.current.gain.gain.value = cue.muted
            ? 0
            : Math.max(0, Math.min(1, cue.volume));
        paint(video.currentTime);
        setVisible(true);
        await video.play();
        video.dataset.celebrationStatus = "playing";
        if (cancelled) {
          video.pause();
          return;
        }
        const nextVideoFrame = (
          _now: number,
          metadata: VideoFrameCallbackMetadata,
        ) => {
          paint(metadata.mediaTime);
          if (!finished && !cancelled)
            frameCallback = video.requestVideoFrameCallback(nextVideoFrame);
        };
        const nextAnimationFrame = () => {
          paint(video.currentTime);
          if (!finished && !cancelled)
            animationFrame = requestAnimationFrame(nextAnimationFrame);
        };
        if ("requestVideoFrameCallback" in video)
          frameCallback = video.requestVideoFrameCallback(nextVideoFrame);
        else animationFrame = requestAnimationFrame(nextAnimationFrame);
        expiryTimer = setTimeout(stop, Math.max(0, cue.expiresAt - Date.now()));
      };
      startTimer = setTimeout(
        () => void start().catch(fail),
        Math.max(0, cue.startedAt - Date.now()),
      );
    };
    void prepare().catch(fail);
    video.addEventListener("ended", stop);
    return () => {
      cancelled = true;
      finished = true;
      clearTimeout(startTimer);
      clearTimeout(expiryTimer);
      video.removeEventListener("ended", stop);
      video.pause();
      video.muted = true;
      if (audioRef.current) audioRef.current.gain.gain.value = 0;
      if (frameCallback) video.cancelVideoFrameCallback(frameCallback);
      cancelAnimationFrame(animationFrame);
    };
  }, [cue?.id, cue?.headshotUrl, nativeAudio, templateId, descriptor]);
  return (
    <>
      <video
        key={nativeAudio ? "native" : "preview"}
        ref={videoRef}
        data-celebration-video=""
        data-source={descriptor.src}
        preload="auto"
        playsInline
        muted
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <div
        data-celebration={visible ? templateId : undefined}
        role={visible ? "img" : undefined}
        aria-label={
          visible
            ? `${cue?.playerName}: ${getCelebrationTemplate(templateId).label}`
            : undefined
        }
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 26,
          display: visible ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          pointerEvents: "none",
          containerType: "size",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CELEBRATION_SQUARE_SIZE}
          height={CELEBRATION_SQUARE_SIZE}
          style={{
            display: "block",
            width: "min(100cqw, 100cqh)",
            height: "min(100cqw, 100cqh)",
            background: "#000",
            objectFit: "contain",
          }}
        />
      </div>
    </>
  );
}
