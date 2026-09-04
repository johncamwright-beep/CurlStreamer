"use client";
import { useEffect, useRef, useState } from "react";
import type { Sponsor } from "@/lib/types";
import { fitSponsorRectangle, sponsorFrameRectangle } from "@/lib/sponsor-fit";
import { DecodedSponsorImage } from "./DecodedSponsorImage";

const PADDING = 14;
const SIDEBAR_LABEL_HEIGHT = 26;

export function SponsorFrame({
  sponsors,
  desiredIndex,
  mode,
}: {
  sponsors: Sponsor[];
  desiredIndex: number;
  mode: "sidebar" | "overlay";
}) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = boundsRef.current;
    if (!element) return;
    const measure = () =>
      setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);
  const labelHeight = mode === "sidebar" ? SIDEBAR_LABEL_HEIGHT : 0;
  const image = fitSponsorRectangle(
    natural.width,
    natural.height,
    Math.max(0, bounds.width - PADDING * 2),
    Math.max(0, bounds.height - PADDING * 2 - labelHeight),
  );
  const frame = sponsorFrameRectangle(image, PADDING, labelHeight);
  return (
    <div
      ref={boundsRef}
      className={`sponsor-frame-bounds sponsor-frame-bounds-${mode}`}
    >
      <div
        data-testid={`sponsor-${mode}`}
        className={`sponsor-fitted-frame sponsor-fitted-frame-${mode}`}
        style={{
          width: frame.width || undefined,
          height: frame.height || undefined,
        }}
      >
        {mode === "sidebar" && (
          <p className="sponsor-frame-label">PRESENTED BY</p>
        )}
        <DecodedSponsorImage
          sponsors={sponsors}
          desiredIndex={desiredIndex}
          className="sponsor-fitted-image"
          width={image.width}
          height={image.height}
          onDimensions={(width, height) => setNatural({ width, height })}
        />
      </div>
    </div>
  );
}
