"use client";
import { useEffect, useRef, useState } from "react";

// Match the native preview's every-other-frame sample of the 30 fps output.
const PREVIEW_INTERVAL_MS = 1000 / 15;
const REQUEST_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 1000;

type PreviewFrame = {
  key: string;
  source: string;
  loaded: () => void;
  failed: () => void;
};

export function StudioProgramPreview({
  gameId,
  embedded = false,
}: {
  gameId: string;
  embedded?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [frames, setFrames] = useState<
    [PreviewFrame | null, PreviewFrame | null]
  >([null, null]);
  const [visible, setVisible] = useState<0 | 1 | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const images = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([
    null,
    null,
  ]);
  const generation = useRef(0);
  useEffect(() => {
    const currentImages = images.current;
    const currentGeneration = ++generation.current;
    let active = true;
    let frameNumber = 0;
    let hasPicture = false;
    let pending: PreviewFrame | null = null;
    let next: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    setFrames([null, null]);
    setVisible(null);
    setReconnecting(false);
    const available = navigator.userAgent.includes("StudioProgramPreview/1");
    setSupported(available);
    if (!available) return;
    function requestFrame(slot: 0 | 1) {
      if (!active) return;
      const started = performance.now();
      const frame: PreviewFrame = {
        key: `${currentGeneration}:${frameNumber}`,
        source: `/__studio-preview/${gameId}?frame=${frameNumber++}`,
        loaded: () => finish(true),
        failed: () => finish(false),
      };
      function finish(loaded: boolean) {
        // A timeout, source change or newer request retires this attempt.
        // Late image callbacks must never swap the visible picture or timers.
        if (!active || pending !== frame) return;
        pending = null;
        clearTimeout(watchdog);
        if (loaded) {
          hasPicture = true;
          setVisible(slot);
          setReconnecting(false);
        } else {
          // Clear only the pending image: the other slot holds the last good
          // picture. Removing its source also abandons a stuck image request.
          currentImages[slot]?.removeAttribute("src");
          setFrames((previous) => {
            const updated = [...previous] as typeof previous;
            updated[slot] = null;
            return updated;
          });
          setReconnecting(hasPicture);
        }
        next = setTimeout(
          () => requestFrame(loaded ? ((1 - slot) as 0 | 1) : slot),
          loaded
            ? Math.max(0, PREVIEW_INTERVAL_MS - (performance.now() - started))
            : RETRY_DELAY_MS,
        );
      }
      pending = frame;
      watchdog = setTimeout(() => finish(false), REQUEST_TIMEOUT_MS);
      setFrames((previous) => {
        const updated = [...previous] as typeof previous;
        updated[slot] = frame;
        return updated;
      });
    }
    requestFrame(0);
    return () => {
      active = false;
      pending = null;
      clearTimeout(next);
      clearTimeout(watchdog);
      for (const image of currentImages) image?.removeAttribute("src");
    };
  }, [gameId]);
  return (
    <section
      aria-label="Studio program preview"
      style={{
        width: embedded ? "100%" : 1920,
        height: embedded ? "auto" : 1080,
        aspectRatio: "16 / 9",
        overflow: "hidden",
        position: "relative",
        background: "#071320",
        color: "white",
      }}
    >
      {supported &&
        frames.map((frame, index) => {
          if (frame === null) return null;
          const slot = index as 0 | 1;
          return (
            // The local shell serves read-only program frames. Keep the last
            // successful frame visible while the next one is loading.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={frame.key}
              ref={(element) => {
                images.current[slot] = element;
              }}
              src={frame.source}
              alt={visible === slot ? "Actual Studio program output" : ""}
              aria-hidden={visible !== slot}
              onLoad={frame.loaded}
              onError={frame.failed}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                opacity: visible === slot ? 1 : 0,
              }}
            />
          );
        })}
      {visible === null && (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeContent: "center",
            textAlign: "center",
            padding: embedded ? 16 : 80,
            fontSize: embedded ? 14 : 36,
          }}
        >
          <h2>
            {supported
              ? "Waiting for Studio’s picture"
              : "Preview on the recording PC"}
          </h2>
          <p>
            {supported
              ? "Connect this game in Studio. Its program picture will appear here."
              : "Open this game in the updated Windows Studio app to see its cameras and score together."}
          </p>
        </div>
      )}
      {visible !== null && reconnecting && (
        <div
          role="status"
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            padding: "6px 10px",
            borderRadius: 6,
            background: "#071320dd",
          }}
        >
          Preview reconnecting…
        </div>
      )}
    </section>
  );
}
