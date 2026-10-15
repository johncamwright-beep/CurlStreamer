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
      <g transform="rotate(35 16 16)" stroke="#172435" strokeWidth="1.4">
        <rect x="13" y="12" width="6" height="18" rx="2" fill="#c68a42" />
        <rect x="4" y="3" width="24" height="12" rx="3" fill="#e2e8ee" />
        <path d="M9 4v10M23 4v10" stroke="#8294a5" />
        <path d="M11 6h10" stroke="white" strokeWidth="2" />
      </g>
    </svg>
  );
}
