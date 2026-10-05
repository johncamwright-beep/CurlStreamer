import {
  currentShots,
  report,
  shotTypes,
  turns,
  executions,
  deficiencies,
  type Shot,
} from "./model";
import type { CoachEvent } from "./event";
import type { Evidence } from "./reports";
export type ReportGame = {
  key: string;
  title: string;
  groups: {
    title: string;
    metrics: { id: string; label: string; value: string }[];
  }[];
};

/** Private player-only snapshots. No raw shots or identities enter AI evidence. */
export function playerReportGames(event: CoachEvent, playerId: string) {
  const evidence: Evidence[] = [];
  const games = event.games.map((g, index): ReportGame => {
    const key = `game-${index + 1}`;
    const shots = currentShots(g.state.events).filter(
      (s) => s.playerId === playerId && !s.excluded,
    );
    const metric = (
      suffix: string,
      label: string,
      value: number | null,
      sample: number,
    ) => {
      const id = `${key}-${suffix}`;
      const display = value === null ? "—" : `${value.toFixed(1)}%`;
      evidence.push({
        id,
        label: `Game ${index + 1}: ${label}`,
        value: value === null ? "Not measured" : display,
        sample,
        confidence: sample < 10 ? "small" : sample < 20 ? "tentative" : "event",
      });
      return { id, label, value: display };
    };
    const shooting = (suffix: string, label: string, subset: Shot[]) => {
      const r = report(subset);
      return metric(suffix, label, r.percent, r.scored);
    };
    const distribution = (
      field: "execution" | "deficiency",
      values: readonly string[],
    ) => {
      const recorded = shots.filter((s) => s[field] !== null);
      return values.map((value, i) =>
        metric(
          `${field}-${i}`,
          value === "Xmiss" ? "Miss" : value,
          recorded.length
            ? (100 * recorded.filter((s) => s[field] === value).length) /
                recorded.length
            : null,
          recorded.length,
        ),
      );
    };
    return {
      key,
      title: g.label || `Game ${index + 1}`,
      groups: [
        {
          title: "Overall shooting",
          metrics: [shooting("overall", "Overall", shots)],
        },
        {
          title: "Shot types",
          metrics: shotTypes.map((t, i) =>
            shooting(
              `type-${i}`,
              t,
              shots.filter((s) => s.type === t),
            ),
          ),
        },
        {
          title: "Turns",
          metrics: turns.map((t, i) =>
            shooting(
              `turn-${i}`,
              t,
              shots.filter((s) => s.turn === t),
            ),
          ),
        },
        {
          title: "Execution · share of recorded labels",
          metrics: distribution("execution", executions),
        },
        {
          title: "Results and miss patterns · share of recorded labels",
          metrics: distribution("deficiency", deficiencies),
        },
      ],
    };
  });
  return { games, evidence };
}
