"use client";
import { useEffect, useRef, useState } from "react";
import type { Sponsor } from "@/lib/types";
import { fitSponsorRectangle, sponsorFrameRectangle } from "@/lib/sponsor-fit";
import { DecodedSponsorImage } from "./DecodedSponsorImage";

const PADDING = 14;
const SIDEBAR_LABEL_HEIGHT = 48;

export function SponsorFrame({
  sponsors,
  desiredIndex,
  mode,
  teamName,
}: {
  sponsors: Sponsor[];
  desiredIndex: number;
  mode: "sidebar" | "overlay";
  teamName?: string;
}) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [programScale, setProgramScale] = useState(1);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = boundsRef.current;
    if (!element) return;
    const measure = () => {
      setBounds({ width: element.clientWidth, height: element.clientHeight });
      const program = element.closest('[data-testid="broadcast-canvas"]');
      setProgramScale(program ? Math.min(1, program.clientWidth / 1280) : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);
  const padding = PADDING * programScale;
  const labelHeight =
    mode === "sidebar" ? SIDEBAR_LABEL_HEIGHT * programScale : 0;
  const image = fitSponsorRectangle(
    natural.width,
    natural.height,
    Math.max(0, bounds.width - padding * 2),
    Math.max(0, bounds.height - padding * 2 - labelHeight),
  );
  const frame = sponsorFrameRectangle(image, padding, labelHeight);
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
          padding,
          borderRadius: 16 * programScale,
        }}
      >
        {mode === "sidebar" && (
          <p
            className="sponsor-frame-label"
            style={{
              height: labelHeight,
              fontSize: 18 * programScale,
              lineHeight: `${22 * programScale}px`,
            }}
          >
            {teamName || "This team"} is sponsored by
          </p>
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
