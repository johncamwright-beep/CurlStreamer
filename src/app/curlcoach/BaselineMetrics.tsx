"use client";

import { useMemo } from "react";
import {
  eventPerformance,
  splitPerformanceEvents,
} from "@/lib/curlcoach/event-performance";
import type { Workspace } from "@/lib/curlcoach/event";

const format = (n: number | null, suffix = "%") =>
  n === null ? "—" : `${n.toFixed(1)}${suffix}`;
export default function BaselineMetrics({
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
  const points = useMemo(
    () =>
      eventPerformance(
        splitPerformanceEvents(workspace.event, workspace.catalog),
        playerId,
      ).points,
    [workspace, playerId],
  );
  const event =
    points.find((p) => p.id === eventId) ??
    (eventId === "all" ? points.at(-1) : undefined);
  const game = event?.games.find((g) => g.id === gameId);
  const metrics = game ?? event;
  if (!metrics || !event) return null;
  const items = [
    {
      label: "Routine shooting",
      value: format(metrics.routinePercent),
      detail: `${metrics.routineShots} routine graded shots`,
    },
    {
      label: "Routine baseline gap",
      value: format(metrics.baselineGap, " pp"),
      detail: `${metrics.matchedRoutineShots} matched · expected ${format(metrics.expectedRoutinePercent)}`,
    },
    {
      label: "Game / event difficulty index",
      value: format(metrics.difficultyIndex, ""),
      detail: `${metrics.ratedShots} rated · 100 = usual difficulty`,
    },
    {
      label: "Routine full-make rate",
      value: format(metrics.routineMakeRate),
      detail: "Routine shots graded 5/5",
    },
  ];
  return (
    <div aria-label="Event baseline comparison">
      <p className="analysis-muted" style={{ padding: "8px 24px", margin: 0 }}>
        {event.name}
        {game ? ` · ${game.name}` : ""} · Compared with all{" "}
        {event.baselineEvents} earlier completed events this season. These event
        metrics use the selected player’s full event or game, independently of
        shot filters.
      </p>
      <div className="analysis-kpis">
        {items.map((item) => (
          <div className="analysis-kpi" key={item.label}>
            <div>{item.label}</div>
            <div className="analysis-value">{item.value}</div>
            <div className="analysis-muted">{item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
