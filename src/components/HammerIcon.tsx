import React from "react";

export function HammerIcon({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-label={label}
      role="img"
      focusable="false"
      className={`${compact ? "h-5 w-5" : "h-7 w-7"} shrink-0 drop-shadow-sm`}
    >
      <circle cx="16" cy="16" r="15" className="fill-amber-300" />
      <path
        d="M5.25 7.25h8.1l4.15 4.15-3.1 3.1-2.25-2.25-7.3 7.3a2.35 2.35 0 0 0 0 3.3l.3.3a2.35 2.35 0 0 0 3.3 0l7.3-7.3L18 18.1l3.1-3.1-7.75-7.75h-8.1Z"
        className="fill-slate-950"
      />
      <path
        d="m17.4 10.55 2.85-2.85 6.5 6.5-2.85 2.85Z"
        className="fill-slate-950"
      />
    </svg>
  );
}
