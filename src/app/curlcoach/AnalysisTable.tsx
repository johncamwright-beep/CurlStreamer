"use client";
import { useState } from "react";
import AnalysisOrder from "./AnalysisOrder";
import {
  rankAnalysis,
  type AnalysisOrder as Order,
} from "@/lib/curlcoach/ranking";
export default function Table({
  title,
  columns,
  rows,
  shotSelector = false,
  selectorLabel = "Shot type",
  optionLabel,
  ranking,
}: {
  title: string;
  columns: readonly string[];
  rows: { label: string; values: (string | number)[] }[];
  shotSelector?: boolean;
  selectorLabel?: string;
  optionLabel?: (label: string) => string;
  ranking?: "performance" | "frequency";
}) {
  const [order, setOrder] = useState<Order>("descending");
  const [shot, setShot] = useState("");
  const selectedShot = rows.some((row) => row.label === shot)
    ? shot
    : (rows[0]?.label ?? "");
  const visibleRows = shotSelector
    ? rows.filter((row) => row.label === selectedShot)
    : ranking
      ? rankAnalysis(
          rows,
          order,
          (row) => {
            const value = Number.parseFloat(String(row.values[0]));
            return Number.isFinite(value) ? value : null;
          },
          (row) => row.label,
        )
      : rows;
  return (
    <section className="event-card">
      <div className="analysis-panelhead">
        <h3>{title}</h3>
        {ranking && !shotSelector && (
          <AnalysisOrder
            title={title}
            value={order}
            onChange={setOrder}
            frequency={ranking === "frequency"}
          />
        )}
      </div>
      {shotSelector && (
        <label className="event-shot-selector">
          {selectorLabel}
          <select
            aria-label={title + " " + selectorLabel.toLowerCase()}
            value={selectedShot}
            onChange={(event) => setShot(event.target.value)}
          >
            {rows.map((row) => (
              <option key={row.label} value={row.label}>
                {optionLabel?.(row.label) ?? row.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        className="event-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">
                {title.includes("Turn") ? "Turn / target" : "Category"}
              </th>
              {columns.map((c) => (
                <th scope="col" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, i) => (
                  <td key={i} data-label={columns[i]}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
