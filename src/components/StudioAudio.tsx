"use client";
import { useEffect, useState } from "react";
import { StudioOverlay } from "./StudioOverlay";
import { StudioUsbAudio } from "./StudioUsbAudio";
import { StudioNativeUsbAudio } from "./StudioNativeUsbAudio";

export function StudioAudio({ id }: { id: string }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [nativeUsb, setNativeUsb] = useState(false);
  useEffect(() => {
    setNativeUsb(navigator.userAgent.includes("StudioNativeAudio/1"));
  }, []);
  return (
    <section className="scoring-card" aria-label="Audio">
      {nativeUsb ? (
        <StudioNativeUsbAudio key={id} gameId={id} />
      ) : (
        <>
          <header className="flex min-h-11 items-center justify-between gap-2">
            <h2 className="font-bold">Audio</h2>
            <button
              className="btn-secondary"
              onClick={() => setSetupOpen(true)}
            >
              USB setup
            </button>
          </header>
          <StudioOverlay
            title="USB setup"
            open={setupOpen}
            onClose={() => setSetupOpen(false)}
          >
            <StudioUsbAudio />
          </StudioOverlay>
        </>
      )}
    </section>
  );
}
