"use client";
import { useEffect, useRef, useState } from "react";
import type { Sponsor } from "@/lib/types";

const DECODE_TIMEOUT_MS = 5000;
export async function decodeSponsor(
  url: string,
  timeoutMs = DECODE_TIMEOUT_MS,
) {
  const image = new Image();
  image.src = url;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Sponsor image timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function DecodedSponsorImage({
  sponsors,
  desiredIndex,
  className,
}: {
  sponsors: Sponsor[];
  desiredIndex: number;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState<Sponsor>();
  const decoded = useRef(new Set<string>());
  const failed = useRef(new Map<string, string>());
  useEffect(() => {
    let cancelled = false;
    const currentUrls = new Map(
      sponsors.map((sponsor) => [sponsor.id, sponsor.dataUrl]),
    );
    for (const [id, url] of failed.current)
      if (currentUrls.get(id) !== url) failed.current.delete(id);
    if (!sponsors.length) {
      setDisplayed(undefined);
      return;
    }
    const prepare = async (sponsor: Sponsor) => {
      if (!decoded.current.has(sponsor.dataUrl)) {
        await decodeSponsor(sponsor.dataUrl);
        decoded.current.add(sponsor.dataUrl);
      }
    };
    void (async () => {
      for (let offset = 0; offset < sponsors.length; offset++) {
        const candidate = sponsors[(desiredIndex + offset) % sponsors.length];
        if (failed.current.get(candidate.id) === candidate.dataUrl) continue;
        try {
          await prepare(candidate);
          if (cancelled) return;
          setDisplayed(candidate);
          const next = sponsors[(desiredIndex + offset + 1) % sponsors.length];
          if (next !== candidate)
            void prepare(next).catch(() =>
              failed.current.set(next.id, next.dataUrl),
            );
          return;
        } catch {
          failed.current.set(candidate.id, candidate.dataUrl);
        }
      }
      if (!cancelled) setDisplayed(undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [desiredIndex, sponsors]);
  if (!displayed) return null;
  return (
    <img
      src={displayed.dataUrl}
      alt={displayed.altText ?? displayed.name}
      className={className}
      style={{ transform: `rotate(${displayed.rotation}deg)` }}
    />
  );
}
