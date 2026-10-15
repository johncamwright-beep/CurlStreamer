import React, { useEffect, useState } from "react";
import {
  programPresentationSchema,
  type ProgramPresentation as Presentation,
} from "@/lib/program-presentation";
import { m4RendererInstance } from "@/lib/providers/m4-renderer-health-browser";

/** Always mounted: hiding the program never removes its camera/audio receivers. */
export function ProgramPresentation() {
  const [state, setState] = useState<Presentation>(() => {
    try {
      const encoded = document.querySelector<HTMLMetaElement>(
        'meta[name="m4-presentation"]',
      )?.content;
      return encoded
        ? programPresentationSchema.parse(
            JSON.parse(
              new TextDecoder().decode(
                Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
              ),
            ),
          )
        : { generation: 0, mode: "live" };
    } catch {
      return { generation: 0, mode: "live" };
    }
  });
  useEffect(() => {
    const abort = new AbortController();
    let retryMs = 250;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch("/presentation", {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]),
        });
        if (response.ok) {
          const next = programPresentationSchema.parse(await response.json());
          retryMs = 250;
          if (!abort.signal.aborted)
            setState((current) =>
              current?.generation === next.generation ? current : next,
            );
        }
      } catch {
        retryMs = Math.min(
          2000,
          retryMs * 2,
        ); /* Retain desired picture through temporary outages. */
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), retryMs);
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const abort = new AbortController();
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    const ack = async () => {
      try {
        await fetch("/presentation-painted", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1500)]),
          body: JSON.stringify({
            instance: m4RendererInstance(),
            generation: state.generation,
          }),
        });
      } catch {
        /* A lost acknowledgement is retried without releasing the card. */
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void ack(), 500);
    };
    // Two animation frames place the committed DOM in the browser paint stream.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void ack());
    });
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [state]);
  if (
    !state ||
    state.mode === "live" ||
    (state.mode === "preparing-end" && !state.holdPicture)
  )
    return null;
  const completion = state.completion;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        display: "grid",
        placeContent: "center",
        justifyItems: "center",
        gap: 36,
        background: "#071320",
        color: "#eef6ff",
        textAlign: "center",
        padding: 80,
        fontFamily: "system-ui",
      }}
    >
      <img
        src="/branding/curlstreamer-logo.png"
        alt="CurlStreamer"
        style={{
          width: 420,
          maxWidth: "80vw",
          height: 240,
          objectFit: "contain",
        }}
      />
      <h1 style={{ fontSize: 64, margin: 0 }}>
        {state.mode === "hold" || state.mode === "preparing-end"
          ? "Stream temporarily off"
          : "Game over"}
      </h1>
      {state.mode === "ended" && completion && (
        <>
          <p style={{ fontSize: 44, margin: 0 }}>
            {completion.result.totals
              ? `${completion.homeName} ${completion.result.totals.home} – ${completion.result.totals.away} ${completion.awayName}`
              : completion.result.label}
          </p>
          <p style={{ fontSize: 28, margin: 0 }}>{completion.eventName}</p>
        </>
      )}
    </div>
  );
}
