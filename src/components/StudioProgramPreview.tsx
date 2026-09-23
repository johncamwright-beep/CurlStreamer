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
  const [frame, setFrame] = useState(0);
  const [ready, setReady] = useState(false);
  const next = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestedAt = useRef(0);
  const schedule = (loaded: boolean) => {
    setReady(loaded);
    clearTimeout(next.current);
    next.current = setTimeout(
      () => {
        requestedAt.current = performance.now();
        setFrame((value) => value + 1);
      },
      loaded
        ? Math.max(0, 1000 / 15 - (performance.now() - requestedAt.current))
        : 1000,
    );
  };
  useEffect(() => {
    setReady(false);
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
      {supported && (
        // Read-only image requests are fulfilled by the local Studio shell.
        // No camera ticket, local address or recording path enters the website.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/__studio-preview/${gameId}?frame=${frame}`}
          alt="Actual Studio program output"
          onLoad={() => schedule(true)}
          onError={() => schedule(false)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: ready ? 1 : 0,
          }}
        />
      )}
      {!ready && (
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
              ? "Start recording in Studio. The program picture will appear here."
              : "Open this game in the updated Windows Studio app to see its cameras and score together."}
          </p>
        </div>
      )}
    </section>
  );
}
