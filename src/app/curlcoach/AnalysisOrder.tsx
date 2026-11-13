"use client";
import type { AnalysisOrder as Order } from "@/lib/curlcoach/ranking";

export default function AnalysisOrder({
  title,
  value,
  onChange,
  frequency = false,
}: {
  title: string;
  value: Order;
  onChange: (order: Order) => void;
  frequency?: boolean;
}) {
  return (
    <select
      className="analysis-order"
      aria-label={`${title} order`}
      value={value}
      onChange={(event) => onChange(event.target.value as Order)}
    >
      <option value="descending">
        {frequency ? "Most frequent first" : "Strongest first"}
      </option>
      <option value="ascending">
        {frequency ? "Least frequent first" : "Weakest first"}
      </option>
      <option value="name">Name A–Z</option>
    </select>
  );
}
