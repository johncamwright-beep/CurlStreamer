import { reportEventPerformance } from "./event-performance";
import { family, difficultyEventShots, type CoachEvent } from "./event";
import { difficultySummary } from "./difficulty";
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
import { reportPlayers, type ReportPacket } from "./reports";
import { playerEventStats } from "./player-event-stats";
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
  const shots = packet.audience === "coach" ? difficultyEventShots(event) : [];
  const playerComparison =
    packet.audience === "coach"
      ? reportPlayers(event).map((player) => {
          const selected = shots.filter((s) => s.playerId === player.id);
          const stats = playerEventStats(selected);
          const raw = report(selected);
          return {
            name: player.name,
            shooting: raw.percent,
            adjusted: stats.adjusted,
            rated: stats.ratedGraded,
            graded: raw.scored,
          };
        })
      : undefined;
  return {
    ...reports,
    reports: reports.reports.map((saved) => ({
      ...saved,
      // Tabs opened before section narratives were introduced still read these legacy fields.
      ...(saved.narrative && "eventStats" in saved.narrative
        ? {
            narrative: {
              ...saved.narrative,
              summary: {
                text: saved.narrative.eventStats.map((f) => f.text).join(" "),
                evidence: [
                  ...new Set(
                    saved.narrative.eventStats.flatMap((f) => f.evidence),
                  ),
                ],
              },
              acrossGames: saved.narrative.eventTrends,
              withinGames: [],
              strengths: [],
              priorities: [],
              practice: [],
              review: [],
            },
          }
        : {}),
      difficulty: saved.difficulty?.estimated ? undefined : saved.difficulty,
      playerComparison,
      ...(event.games.every((g) => g.difficultyReady) &&
      (packet.audience !== "players" || saved.playerId)
        ? {
            difficulty: difficultySummary(
              difficultyEventShots(event).filter(
                (s) => !saved.playerId || s.playerId === saved.playerId,
              ),
            ),
          }
        : {}),
      eventPerformance:
        packet.audience !== "players" || saved.playerId
          ? reportEventPerformance(
              event,
              saved.playerId,
              packet.audience === "players",
            )
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
