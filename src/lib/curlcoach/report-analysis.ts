import { analysisEventShots } from "./advanced-analysis";
import { rockNumber } from "./lineup";
import { reviewLink } from "./review";
import { reportEventPerformance } from "./event-performance";
import { family, difficultyEventShots, type CoachEvent } from "./event";
import { difficultySummary } from "./difficulty";
import { withReportFlags } from "./flagged-shots";
import { executions, report, shotTypes, turns, type Shot } from "./model";
import { rankAnalysis } from "./ranking";
import {
  reportMisses,
  taggedMissLabels,
  shotReviewStats,
  type MissAnalysis,
} from "./report-misses";
import {
  reportPlayers,
  type ReportAudience,
  type ReportPacket,
} from "./reports";
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
  shotReview?: ReturnType<typeof shotReviewStats>;
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
  const charted = analysisEventShots(event);
  const games = event.games.map((game, index) => ({
    label: game.label || `Game ${index + 1}`,
    shots: charted.filter(
      (shot) =>
        shot.gameId === game.id &&
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
    misses: reportMisses(event, playerId, charted),
    shotReview: shotReviewStats(shots),
    technical: technicalSummary(shots),
  };
}

export type GameMissList = {
  game: string;
  shots: {
    end: number;
    rock: number;
    type: string;
    tags: string[];
    flag?: { url: string | null };
  }[];
};

function taggedGameShots(event: CoachEvent, audience: ReportAudience) {
  return event.games.map((game, index) => {
    const shots = analysisEventShots({ ...event, games: [game] }).flatMap(
      (shot) => {
        if (shot.excluded) return [];
        const tags = taggedMissLabels(shot);
        if (!tags.length) return [];
        const flagAudience = shot.flagAudience === "team" ? "team" : "players";
        const visibleFlag =
          (shot.flagged ?? !!shot.review) &&
          (audience === "coach" || audience === flagAudience);
        return [
          {
            playerId: shot.playerId,
            row: {
              end: shot.end,
              rock: rockNumber(shot),
              type: shot.type ?? "Unspecified",
              tags,
              ...(visibleFlag
                ? { flag: { url: reviewLink(shot.videoReview) } }
                : {}),
            },
          },
        ];
      },
    );
    shots.sort((a, b) => a.row.end - b.row.end || a.row.rock - b.row.rock);
    return {
      game: [`Game ${index + 1}`, game.opponent && `vs ${game.opponent}`]
        .filter(Boolean)
        .join(" · "),
      shots,
    };
  });
}

/** Add current charted statistics at read time, outside the saved AI narrative. */
export function withReportAnalysis(
  packet: ReportPacket,
  event: CoachEvent,
): ReportPacket {
  const reports = withReportFlags(packet, event);
  const missGames = taggedGameShots(event, packet.audience);
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
      missesByGame:
        packet.audience !== "players" || saved.playerId
          ? missGames.map(({ game, shots }) => ({
              game,
              shots: shots
                .filter(
                  (s) =>
                    packet.audience !== "players" ||
                    s.playerId === saved.playerId,
                )
                .map((s) => s.row),
            }))
          : undefined,
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
