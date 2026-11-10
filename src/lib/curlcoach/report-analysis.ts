import { reportEventPerformance } from "./event-performance";
import { family, type CoachEvent } from "./event";
import { withReportFlags } from "./flagged-shots";
import {
  currentShots,
  executions,
  report,
  shotTypes,
  turns,
  type Shot,
} from "./model";
import { rankAnalysis } from "./ranking";
import { reportMisses, type MissAnalysis } from "./report-misses";
import type { ReportPacket } from "./reports";
import { technicalSummary, type TechnicalSummary } from "./technical";

export type ShootingRow = {
  label: string;
  percent: number | null;
  graded: number;
  shots: number;
};

export type ReportAnalysis = {
  overview: ShootingRow[];
  execution: { label: string; count: number }[];
  games: ShootingRow[];
  shotTypes: ShootingRow[];
  turns: ShootingRow[];
  misses: MissAnalysis;
  technical: TechnicalSummary;
};

function row(label: string, shots: Shot[]): ShootingRow {
  const result = report(shots);
  return {
    label,
    percent: result.percent,
    graded: result.scored,
    shots: shots.length,
  };
}

export function reportAnalysis(
  event: CoachEvent,
  playerId?: string,
): ReportAnalysis {
  const games = event.games.map((game, index) => ({
    label: game.label || `Game ${index + 1}`,
    shots: currentShots(game.state.events).filter(
      (shot) =>
        !shot.excluded &&
        (playerId === undefined || shot.playerId === playerId),
    ),
  }));
  const shots = games.flatMap((game) => game.shots);
  const performance = (labels: readonly string[], field: "turn" | "type") =>
    rankAnalysis(
      labels
        .map((label) =>
          row(
            label,
            shots.filter((shot) => shot[field] === label),
          ),
        )
        .filter((result) => result.shots > 0),
      "descending",
      (result) => result.percent,
      (result) => result.label,
    );
  return {
    overview: [
      row("Overall shooting", shots),
      row(
        "Draws",
        shots.filter((shot) => family(shot) === "Draws"),
      ),
      row(
        "Hits",
        shots.filter((shot) => family(shot) === "Hits"),
      ),
    ],
    execution: executions.map((execution) => ({
      label: execution === "Xmiss" ? "Miss" : execution,
      count: shots.filter((shot) => shot.execution === execution).length,
    })),
    games: games.map((game) => row(game.label, game.shots)),
    shotTypes: performance(shotTypes, "type"),
    turns: performance(turns, "turn"),
    misses: reportMisses(event, playerId),
    technical: technicalSummary(shots),
  };
}

/** Add current charted statistics at read time, outside the saved AI narrative. */
export function withReportAnalysis(
  packet: ReportPacket,
  event: CoachEvent,
): ReportPacket {
  const reports = withReportFlags(packet, event);
  const aggregate =
    packet.audience === "players" ? undefined : reportAnalysis(event);
  return {
    ...reports,
    reports: reports.reports.map((saved) => ({
      ...saved,
      eventPerformance:
        packet.audience !== "players" || saved.playerId
          ? reportEventPerformance(event, saved.playerId)
          : undefined,
      analysis:
        packet.audience === "players"
          ? saved.playerId
            ? reportAnalysis(event, saved.playerId)
            : undefined
          : aggregate,
    })),
  };
}
