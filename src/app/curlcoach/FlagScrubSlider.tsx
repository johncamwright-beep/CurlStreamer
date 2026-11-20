import { useRef } from "react";

export const flagNudgeSeconds = 0.25;
const thumbRadius = 12;

type Drag = {
  pointerId: number;
  trackStart: number;
  trackWidth: number;
  grabOffset: number;
  first: number;
  last: number;
};

export default function FlagScrubSlider({
  first,
  last,
  time,
  description,
  onSeek,
}: {
  first: number;
  last: number;
  time: number;
  description: string;
  onSeek: (time: number) => void;
}) {
  const drag = useRef<Drag | null>(null);

  function move(active: Drag, x: number) {
    const fraction =
      (x - active.grabOffset - active.trackStart) / active.trackWidth;
    onSeek(
      active.first +
        Math.max(0, Math.min(1, fraction)) * (active.last - active.first),
    );
  }

  return (
    <input
      aria-label="Shot start"
      aria-valuetext={description}
      className="shot-flag-slider"
      type="range"
      min={first}
      max={last}
      step="any"
      value={time}
      onChange={(event) => {
        if (!drag.current) onSeek(Number(event.target.value));
      }}
      onKeyDown={(event) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        const forward = event.key === "ArrowRight" || event.key === "ArrowUp";
        onSeek(
          Math.max(
            first,
            Math.min(
              last,
              time + (forward ? flagNudgeSeconds : -flagNudgeSeconds),
            ),
          ),
        );
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || first >= last) return;
        const slider = event.currentTarget;
        const bounds = slider.getBoundingClientRect();
        const trackStart = bounds.left + thumbRadius;
        const trackWidth = Math.max(1, bounds.width - 2 * thumbRadius);
        const thumbX =
          trackStart + ((time - first) / (last - first)) * trackWidth;
        const fromThumb = event.clientX - thumbX;
        const grabbedThumb = Math.abs(fromThumb) <= thumbRadius;
        event.preventDefault();
        slider.focus({ preventScroll: true });
        slider.setPointerCapture(event.pointerId);
        const active = {
          pointerId: event.pointerId,
          trackStart,
          trackWidth,
          grabOffset: grabbedThumb ? fromThumb : 0,
          first,
          last,
        };
        drag.current = active;
        if (grabbedThumb) onSeek(time);
        else move(active, event.clientX);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId) move(active, event.clientX);
      }}
      onPointerUp={(event) => {
        // The last move owns the selection. A lift can land off the thumb.
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onClick={(event) => event.preventDefault()}
    />
  );
}
