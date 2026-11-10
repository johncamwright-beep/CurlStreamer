"use client";

import { useMemo, useState } from "react";
import {
  eventPerformance,
  splitPerformanceEvents,
  type EventPerformancePoint,
} from "@/lib/curlcoach/event-performance";
import type { Workspace } from "@/lib/curlcoach/event";
import { shotTypes } from "@/lib/curlcoach/model";
import { shotSubtypes } from "@/lib/curlcoach/shot-subtypes";

const format = (value: number | null, suffix = "%") =>
  value === null ? "—" : `${value.toFixed(1)}${suffix}`;
export default function EventPerformance({
  workspace,
  playerId,
  eventId,
  gameId,
}: {
  workspace: Workspace;
  playerId?: string;
  eventId: string;
  gameId: string;
}) {
  const [series, setSeries] = useState("overall");
  const performance = useMemo(
    () =>
      eventPerformance(
        splitPerformanceEvents(workspace.event, workspace.catalog),
        playerId,
      ),
    [workspace, playerId],
  );
  const points = performance.points;
  const current =
    points.find((p) => p.id === eventId) ??
    (eventId === "all" ? points.at(-1) : undefined);
  const metrics = current?.games.find((g) => g.id === gameId) ?? current;
  const value = (p: EventPerformancePoint) =>
    series === "overall"
      ? p.percent
      : series === "routine"
        ? p.routinePercent
        : series === "gap"
          ? p.baselineGap
          : series === "difficulty"
            ? p.difficultyIndex
            : series.startsWith("type:")
              ? (p.byType[series.slice(5)]?.percent ?? null)
              : (p.bySubtype[series.slice(8)]?.percent ?? null);
  const count = (p: EventPerformancePoint) =>
    series === "routine"
      ? p.routineShots
      : series === "gap"
        ? p.matchedRoutineShots
        : series === "difficulty"
          ? p.ratedShots
          : series.startsWith("type:")
            ? (p.byType[series.slice(5)]?.graded ?? 0)
            : series.startsWith("subtype:")
              ? (p.bySubtype[series.slice(8)]?.graded ?? 0)
              : p.graded;
  const suffix = series === "gap" ? " pp" : series === "difficulty" ? "" : "%";
  const values = points.map(value).filter((v): v is number => v !== null);
  const min = series === "gap" ? Math.min(-10, ...values) : 0;
  const max =
    series === "gap"
      ? Math.max(10, ...values)
      : series === "difficulty"
        ? Math.max(150, ...values)
        : 100;
  const x = (i: number) =>
    55 + (points.length < 2 ? 280 : (560 * i) / (points.length - 1));
  const y = (v: number) => 150 - (125 * (v - min)) / (max - min);
  return (
    <section
      className="analysis-dashboard analysis-panel event-performance"
      aria-label="Event performance over time"
    >
      <div className="analysis-panelhead">
        <h2>Event performance over time</h2>
        <label>
          Measure{" "}
          <select
            value={series}
            onChange={(e) => setSeries(e.target.value)}
            style={{ minHeight: 44 }}
          >
            <option value="overall">Overall shooting</option>
            <option value="routine">Routine shooting</option>
            <option value="gap">Routine baseline gap</option>
            <option value="difficulty">Shot-mix difficulty index</option>
            <optgroup label="Shot types">
              {shotTypes.map((type) => (
                <option key={type} value={`type:${type}`}>
                  {type}
                </option>
              ))}
            </optgroup>
            <optgroup label="Shot subtypes">
              {shotSubtypes.map((type) => (
                <option key={type.id} value={`subtype:${type.id}`}>
                  {type.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <p>
        Season history for the selected team or player. Event and game
        selections set the comparison cards; the chart keeps the full season.
        Other shot filters do not apply here.
      </p>
      {metrics && (
        <>
          <p>
            <strong>
              {current?.name}
              {gameId !== "all" && metrics !== current
                ? ` · ${current?.games.find((g) => g.id === gameId)?.name}`
                : ""}
            </strong>
          </p>
          <dl className="event-performance-metrics">
            <div>
              <dt>Routine shooting</dt>
              <dd>{format(metrics.routinePercent)}</dd>
            </div>
            <div>
              <dt>Routine baseline gap</dt>
              <dd>{format(metrics.baselineGap, " pp")}</dd>
            </div>
            <div>
              <dt>Game / event difficulty index</dt>
              <dd>{format(metrics.difficultyIndex, "")}</dd>
            </div>
            <div>
              <dt>Routine full-make rate</dt>
              <dd>{format(metrics.routineMakeRate)}</dd>
            </div>
          </dl>
          <p>
            Routine comparison: {metrics.matchedRoutineShots} of{" "}
            {metrics.routineShots} routine shots matched;{" "}
            {format(metrics.matchedRoutinePercent)} actual versus{" "}
            {format(metrics.expectedRoutinePercent)} expected.{" "}
            {metrics.matchedRoutineShots < 5 ? "Limited comparable data." : ""}
          </p>
          <p>
            Difficulty rated on {metrics.ratedShots} of {metrics.gradedShots}{" "}
            graded shots. Average {format(metrics.averageDifficulty, "")} versus{" "}
            {format(metrics.baselineDifficulty, "")} historically; difficult
            shots {format(metrics.difficultShare)} versus{" "}
            {format(metrics.baselineDifficultShare)}.
          </p>
        </>
      )}
      {!points.length ? (
        <p>No event history available.</p>
      ) : (
        <>
          <svg
            viewBox="0 0 670 190"
            role="img"
            aria-label="Selected measure across events in chronological order"
            style={{ width: "100%", maxHeight: 280 }}
          >
            {[min, (min + max) / 2, max].map((v) => (
              <g key={v}>
                <line
                  x1="55"
                  x2="615"
                  y1={y(v)}
                  y2={y(v)}
                  stroke="currentColor"
                  opacity="0.2"
                />
                <text
                  x="48"
                  y={y(v) + 4}
                  textAnchor="end"
                  fill="currentColor"
                  fontSize="12"
                >
                  {v.toFixed(0)}
                </text>
              </g>
            ))}
            {(series === "difficulty" || series === "gap") && (
              <line
                x1="55"
                x2="615"
                y1={y(series === "gap" ? 0 : 100)}
                y2={y(series === "gap" ? 0 : 100)}
                stroke="currentColor"
                strokeDasharray="4 4"
              />
            )}
            {points.map((p, i) => {
              const v = value(p),
                previous = i ? value(points[i - 1]) : null;
              return (
                <g key={p.id}>
                  <text
                    x={x(i)}
                    y="177"
                    textAnchor="middle"
                    fontSize="12"
                    fill="currentColor"
                  >
                    {i + 1}
                  </text>
                  {v !== null && (
                    <>
                      {previous !== null && (
                        <line
                          x1={x(i - 1)}
                          y1={y(previous)}
                          x2={x(i)}
                          y2={y(v)}
                          stroke="#8ecaff"
                          strokeWidth="3"
                        />
                      )}
                      <circle cx={x(i)} cy={y(v)} r="5" fill="#8ecaff">
                        <title>
                          {p.name}: {format(v, suffix)} · {count(p)} shots
                        </title>
                      </circle>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Value</th>
                  <th>Eligible shots</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      {i + 1}. {p.name}
                      {p.complete ? "" : " (in progress)"}
                    </td>
                    <td>{p.date ?? "Unknown"}</td>
                    <td>{format(value(p), suffix)}</td>
                    <td>
                      {count(p)}
                      {count(p) > 0 && count(p) < 5 ? " · small sample" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <details>
        <summary style={{ minHeight: 44 }}>How these comparisons work</summary>
        <p>
          Shooting = total graded points / total possible points. Picks and
          ungraded shots are excluded. Missing values are gaps, not zero.
          Baselines use up to five earlier completed events in this season,
          excluding the current event and overlapping events. Routine
          expectations match the same player and subtype, with at least five
          historical routine shots per match. The gap uses only matched shots.
        </p>
        <p>
          Difficulty weights: Easy 1, Moderate 2, Difficult 3. Index = current
          mean / historical mean × 100. An index of 100 is usual difficulty.
          This is an ordinal shot-mix comparison, not percentage harder or
          opponent strength. Difficulty should be assessed before the outcome.
          Unrated shots are excluded.
        </p>
      </details>
    </section>
  );
}
