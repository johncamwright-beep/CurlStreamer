"use client";
import { useEffect, useState } from "react";
import { StudioUsbAudio } from "./StudioUsbAudio";
import { StudioNativeUsbAudio } from "./StudioNativeUsbAudio";

export function StudioAudio({ id }: { id: string }) {
  const [nativeUsb, setNativeUsb] = useState(false);
  useEffect(() => {
    setNativeUsb(navigator.userAgent.includes("StudioNativeAudio/1"));
  }, []);
  return (
    <section className="scoring-card" aria-label="Audio">
      {nativeUsb ? (
        <StudioNativeUsbAudio key={id} gameId={id} />
      ) : (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2">
            <h2 className="font-bold">Audio</h2>
            <span className="text-sm">USB setup</span>
          </summary>
          <StudioUsbAudio />
        </details>
      )}
    </section>
  );
}
