export function ShotTrackerIcon({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="23" fill="#1263CA" />
      <circle cx="24" cy="24" r="16" fill="#EFF6FF" />
      <circle cx="24" cy="24" r="9" fill="#E64F68" />
      <circle cx="24" cy="24" r="3.5" fill="#EFF6FF" />
      <path
        d="M24 5v8M35 24h8"
        stroke="#9FD4FF"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m9 36 10-10"
        stroke="#09203A"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ShotTrackerBrand() {
  return (
    <a
      className="shot-tracker-brand"
      href="#charting"
      aria-label="Shot Tracker — Charting"
    >
      <ShotTrackerIcon />
      <span>Shot Tracker</span>
    </a>
  );
}
