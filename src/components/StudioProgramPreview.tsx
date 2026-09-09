"use client";
import { useEffect, useState } from "react";

export function StudioProgramPreview({ gameId }: { gameId: string }) {
  const [supported, setSupported] = useState(false);
  const [frame, setFrame] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const available = navigator.userAgent.includes("StudioProgramPreview/1");
    setSupported(available);
    if (!available) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, [gameId]);
  return (
    <section
      aria-label="Studio program preview"
      style={{
        width: 1920,
        height: 1080,
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
          onLoad={() => setReady(true)}
          onError={() => setReady(false)}
          style={{
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
            padding: 80,
            fontSize: 36,
          }}
        >
          <h1>
            {supported
              ? "Waiting for Studio’s picture"
              : "Preview on the recording PC"}
          </h1>
          <p>
            {supported
              ? "Start this game in Studio. The program picture will appear here."
              : "Open this game in the updated Windows Studio app to see its cameras and score together."}
          </p>
        </div>
      )}
    </section>
  );
}
