"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { GameState } from "@/lib/types";
import { StudioUsbAudio } from "./StudioUsbAudio";

const meter = z.object({
  peak: z.number().min(0).max(1),
  rms: z.number().min(0).max(1),
  receiving: z.boolean(),
});
export function StudioAudio({
  id,
  cameraAudio,
}: {
  id: string;
  cameraAudio: GameState["cameraAudio"];
}) {
  const [levels, setLevels] = useState<Record<string, z.infer<typeof meter>>>(
    {},
  );
  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const value = z
        .object({ gameId: z.literal(id), cameras: z.record(z.string(), meter) })
        .safeParse((event as CustomEvent).detail);
      if (!value.success) return;
      setLevels(value.data.cameras);
      clearTimeout(expiry);
      expiry = setTimeout(() => setLevels({}), 6000);
    };
    window.addEventListener("studio-audio-status", receive);
    return () => {
      clearTimeout(expiry);
      window.removeEventListener("studio-audio-status", receive);
    };
  }, [id]);
  return (
    <section className="scoring-card" aria-label="Audio">
      <h2 className="font-bold">Audio</h2>
      <div className="grid grid-cols-2 gap-3 mt-2">
        {(["camera-home", "camera-away"] as const).map((role, index) => {
          const enabled = cameraAudio?.[role]?.enabled;
          const actual = levels[role];
          const receiving = enabled && actual?.receiving;
          const state = cameraAudio?.[role]?.status;
          return (
            <div key={role}>
              <div className="flex justify-between text-sm">
                <span>Camera {index + 1}</span>
                <span>
                  {!enabled
                    ? "Mic off"
                    : receiving
                      ? "Receiving audio"
                      : state === "permission-required"
                        ? "Allow mic on phone"
                        : state === "error"
                          ? "Check phone mic"
                          : "Waiting for audio"}
                </span>
              </div>
              {enabled && (
                <meter
                  className="w-full"
                  aria-label={`Camera ${index + 1} audio level`}
                  min={0}
                  max={1}
                  low={0.05}
                  high={0.9}
                  optimum={0.5}
                  value={receiving ? actual.peak : 0}
                />
              )}
            </div>
          );
        })}
      </div>
      <StudioUsbAudio />
    </section>
  );
}
