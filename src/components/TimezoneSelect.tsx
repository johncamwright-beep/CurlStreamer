import type { SelectHTMLAttributes } from "react";

export const DEFAULT_TIMEZONE = "America/Toronto";
const zones = [
  ["America/Toronto", "Eastern Time (Toronto)"],
  ["America/Winnipeg", "Central Time (Winnipeg)"],
  ["America/Regina", "Central Time (Saskatchewan)"],
  ["America/Edmonton", "Mountain Time (Edmonton)"],
  ["America/Vancouver", "Pacific Time (Vancouver)"],
  ["America/Halifax", "Atlantic Time (Halifax)"],
  ["America/St_Johns", "Newfoundland Time (St. John’s)"],
  ["America/Whitehorse", "Yukon Time (Whitehorse)"],
  ["America/Phoenix", "Arizona Time (Phoenix)"],
  ["America/Anchorage", "Alaska Time (Anchorage)"],
  ["Pacific/Honolulu", "Hawaii Time (Honolulu)"],
  ["Europe/London", "United Kingdom (London)"],
  ["Europe/Zurich", "Central European Time (Zurich)"],
  ["Asia/Tokyo", "Japan Time (Tokyo)"],
  ["UTC", "Coordinated Universal Time (UTC)"],
];

export function TimezoneSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const selected = String(
    props.value ?? props.defaultValue ?? DEFAULT_TIMEZONE,
  );
  return (
    <select
      name="timezone"
      required
      className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
      {...(props.value === undefined ? { defaultValue: DEFAULT_TIMEZONE } : {})}
      {...props}
    >
      {zones.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
      {!zones.some(([value]) => value === selected) && (
        <option value={selected}>{selected.replaceAll("_", " ")}</option>
      )}
    </select>
  );
}
