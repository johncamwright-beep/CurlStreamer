import type { EventLevel } from "@/lib/team-hierarchy";
import { withBroadcastReview, type BroadcastReview } from "./review";
import {
  currentShots,
  emptyState,
  report,
  roster,
  shotTypes,
  turns,
  executions,
  deficiencies,
  type RosterEntry,
  type Shot,
  type State,
} from "./model";
import { activeEvents } from "@/lib/scoring";
import type { GameConfig, ScoreEvent, Team } from "@/lib/types";

export type CoachGame = {
  id: string;
  eventId: string;
  label: string;
  opponent: string;
  teamName: string;
  scheduledEnds: number;
  competitionLevel?: EventLevel | null;
  scheduledStart?: string | null;
  timezone?: string | null;
  status: string;
  side: Team;
  initialHammer: Team | null;
  ends: {
    end: number;
    us: number;
    them: number;
    hammer: boolean | null;
    hammerBefore?: boolean | null;
  }[];
  scoreboardAvailable: boolean;
  broadcastReview?: BroadcastReview;
  roster?: RosterEntry[];
  state: State;
};
export type CoachEvent = {
  id: string;
  name: string;
  source: "sample" | "streamer";
  organizationId: string;
  seasonId?: string;
  games: CoachGame[];
};
export type Workspace = {
  event: CoachEvent;
  catalog: { id: string; name: string; seasonId?: string }[];
  seasons?: { id: string; name: string }[];
  refreshedAt: string;
};
export function gameShots(game: CoachGame) {
  return currentShots(game.state.events).map((shot) =>
    withBroadcastReview(shot, game.broadcastReview),
  );
}
export function eventShots(event: CoachEvent) {
  return event.games.flatMap((game) =>
    gameShots(game).map((shot) => ({ ...shot, gameId: game.id })),
  );
}
export function family(shot: Shot) {
  return shot.type === null
    ? null
    : shotTypes.indexOf(shot.type) < 5
      ? "Draws"
      : "Hits";
}
/** Lead!K10:K21 and Data Tables!B41:B52 use typed attempts as denominator. */
export function workbookCategoryPercent(shots: Shot[]) {
  let attempts = 0;
  let points = 0;
  for (const shot of shots) {
    if (!shot.excluded && shot.type !== null) {
      attempts++;
      points += shot.grade ?? 0;
    }
  }
  return attempts ? (points / (attempts * 5)) * 100 : null;
}
export function grouped(
  shots: Shot[],
  labels: readonly string[],
  key: (shot: Shot) => string | null,
  aggregateLabel?: string,
  aggregate?: (shot: Shot) => boolean,
) {
  const categories = new Map(labels.map((label) => [label, [] as Shot[]]));
  const combined: Shot[] = [];
  for (const shot of shots) {
    const value = key(shot);
    if (value !== null) categories.get(value)?.push(shot);
    if (aggregate ? aggregate(shot) : value !== null && categories.has(value))
      combined.push(shot);
  }
  const groups = labels.map((label) => ({
    label,
    ...report(categories.get(label)!),
  }));
  return aggregateLabel
    ? [{ label: aggregateLabel, ...report(combined) }, ...groups]
    : groups;
}
export function matrix(
  shots: Shot[],
  rows: readonly string[],
  columns: readonly string[],
  row: (s: Shot) => string | null,
  column: (s: Shot) => string | null,
) {
  const rowIndex = new Map(rows.map((label, index) => [label, index]));
  const columnIndex = new Map(columns.map((label, index) => [label, index]));
  const counts = rows.map(() => columns.map(() => 0));
  for (const shot of shots) {
    if (shot.excluded) continue;
    const rowValue = row(shot);
    const columnValue = column(shot);
    const r = rowValue === null ? undefined : rowIndex.get(rowValue);
    const c = columnValue === null ? undefined : columnIndex.get(columnValue);
    if (r !== undefined && c !== undefined) counts[r][c]++;
  }
  return rows.map((label, index) => ({ label, values: counts[index] }));
}
/** Share within outcomes that were actually recorded for this selected group. */
export function outcomePercent(shots: Shot[], outcome: string) {
  let recorded = 0;
  let matches = 0;
  for (const shot of shots) {
    if (!shot.excluded && shot.deficiency !== null) {
      recorded++;
      if (shot.deficiency === outcome) matches++;
    }
  }
  return recorded ? (matches / recorded) * 100 : null;
}
export function scoreboard(
  config: Pick<GameConfig, "initialHammer">,
  events: ScoreEvent[],
  side: Team,
): CoachGame["ends"] {
  let hammer = config.initialHammer ?? null;
  return activeEvents(events).flatMap((event) => {
    if (event.type === "hammer") {
      hammer = event.team;
      return [];
    }
    if (event.type !== "end") return [];
    const score = event.score;
    const hammerBefore = hammer === null ? null : hammer === side;
    if (!score.blank && score.team)
      hammer = score.team === "home" ? "away" : "home";
    return [
      {
        end: score.end,
        us: score.team === side ? score.points : 0,
        them: score.team && score.team !== side ? score.points : 0,
        hammer: hammer === null ? null : hammer === side,
        hammerBefore,
      },
    ];
  });
}
export function scoreTimeline(game: CoachGame) {
  let us = 0,
    them = 0;
  return [
    {
      end: 0,
      us: 0,
      them: 0,
      difference: 0,
      hammer:
        game.initialHammer === null ? null : game.initialHammer === game.side,
    },
    ...game.ends.map((end) => {
      us += end.us;
      them += end.them;
      return { ...end, us, them, difference: us - them };
    }),
  ];
}
export function sampleEvent(id: string): CoachEvent {
  if (!["practice", "shorty-example"].includes(id))
    throw new Error("Event not found");
  const count = id === "practice" ? 1 : 7;
  return {
    id,
    name:
      id === "practice" ? "My practice session" : "Shorty Jenkins · example",
    source: "sample",
    organizationId: "curlcoach-synthetic-org",
    seasonId: "sample-season",
    games: Array.from({ length: count }, (_, g) => {
      const gameId =
        id === "practice"
          ? "curlcoach-synthetic-game"
          : `shorty-example-${g + 1}`;
      const state = { ...emptyState(), gameId };
      if (id !== "practice")
        for (let end = 1; end <= 8; end++)
          for (let p = 0; p < 4; p++)
            for (let stone = 1; stone <= 2; stone++) {
              const n = state.events.length;
              const grade =
                (n + g * 3) % 11 === 0 ? null : 2 + ((n * 7 + g) % 4);
              const excluded = (n + g) % 31 === 0 ? ("Pick" as const) : null;
              state.events.push({
                requestId: `00000000-0000-4000-8000-${String(g * 1000 + n + 1).padStart(12, "0")}`,
                shotId: `10000000-0000-4000-8000-${String(g * 1000 + n + 1).padStart(12, "0")}`,
                expectedRevision: n,
                revision: n + 1,
                at: "2026-09-13T12:00:00.000Z",
                actor: "synthetic-coach",
                shot: {
                  playerId: roster[p].id,
                  position: ["Lead", "Second", "Third", "Fourth"][
                    p
                  ] as Shot["position"],
                  end,
                  stone,
                  type: shotTypes[(n + g) % 10],
                  turn: turns[(n + g) % 8],
                  execution: executions[(n + g) % 4],
                  grade: excluded ? null : grade,
                  deficiency: deficiencies[(n + g) % 6],
                  review: null,
                  excluded,
                  note: "",
                },
              });
            }
      state.revision = state.events.length;
      return {
        id: gameId,
        eventId: id,
        label: `Game ${g + 1}`,
        opponent:
          id === "practice" ? "Practice opponent" : `Example team ${g + 1}`,
        teamName: "Practice team",
        competitionLevel: id === "practice" ? null : g < 3 ? "U18" : "Men’s",
        scheduledEnds: 8,
        status: id === "practice" ? "active" : "completed",
        side: "home",
        initialHammer: "home",
        scoreboardAvailable: id !== "practice",
        ends:
          id === "practice"
            ? []
            : Array.from({ length: 8 }, (_, e) => ({
                end: e + 1,
                us: (e + g) % 3 === 0 ? 2 : 0,
                them: (e + g) % 3 === 1 ? 1 : 0,
                hammer: (e + g) % 3 === 0 ? false : true,
              })),
        state,
      };
    }),
  };
}
export const sampleCatalog = [
  { id: "practice", name: "My practice session", seasonId: "sample-season" },
  {
    id: "shorty-example",
    name: "Shorty Jenkins · example (7 games)",
    seasonId: "sample-season",
  },
];
