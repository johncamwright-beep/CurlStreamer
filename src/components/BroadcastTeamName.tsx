"use client";
import React, { useEffect, useRef } from "react";

/** Measure the actual typeface and space remaining beside the score/hammer. */
export function BroadcastTeamName({ name }: { name: string }) {
  const bounds = useRef<HTMLElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = bounds.current;
    const label = text.current;
    if (!container || !label) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      label.style.fontSize = "1em";
      const naturalWidth = label.getBoundingClientRect().width;
      if (naturalWidth > 0 && container.clientWidth > 0)
        label.style.fontSize = `${Math.min(1, container.clientWidth / naturalWidth)}em`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    void document.fonts.ready.then(fit);
    fit();
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [name]);
  return (
    <strong ref={bounds} className="broadcast-team-name min-w-0">
      <span ref={text} className="inline-block whitespace-nowrap">
        {name}
      </span>
    </strong>
  );
}
