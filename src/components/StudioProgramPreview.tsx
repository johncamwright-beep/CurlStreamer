"use client";
import { useEffect, useRef, useState } from "react";

export function StudioProgramPreview({
  gameId,
  embedded = false,
}: {
  gameId: string;
  embedded?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [frames, setFrames] = useState<[number | null, number | null]>([
    0,
    null,
  ]);
  const [visible, setVisible] = useState<0 | 1 | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const next = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frameNumber = useRef(0);
  const requestedAt = useRef(0);
  const lastLoadedAt = useRef(0);
  const schedule = (slot: 0 | 1, loaded: boolean) => {
    if (loaded) {
      lastLoadedAt.current = performance.now();
      setVisible(slot);
      setReconnecting(false);
    } else if (
      lastLoadedAt.current > 0 &&
      performance.now() - lastLoadedAt.current > 3000
    ) {
      setReconnecting(true);
    }
    clearTimeout(next.current);
    next.current = setTimeout(
      () => {
        const target = loaded ? ((1 - slot) as 0 | 1) : slot;
        requestedAt.current = performance.now();
        const value = ++frameNumber.current;
        setFrames((previous) => {
          const updated = [...previous] as [number | null, number | null];
          updated[target] = value;
          return updated;
        });
      },
      loaded
        ? Math.max(0, 1000 / 15 - (performance.now() - requestedAt.current))
        : 1000,
    );
  };
  useEffect(() => {
    setFrames([0, null]);
    setVisible(null);
    setReconnecting(false);
    frameNumber.current = 0;
    lastLoadedAt.current = 0;
    const available = navigator.userAgent.includes("StudioProgramPreview/1");
    setSupported(available);
    if (!available) return;
    requestedAt.current = performance.now();
    return () => clearTimeout(next.current);
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
              key={slot}
              src={`/__studio-preview/${gameId}?frame=${frame}`}
              alt={visible === slot ? "Actual Studio program output" : ""}
              aria-hidden={visible !== slot}
              onLoad={() => schedule(slot, true)}
              onError={() => schedule(slot, false)}
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
