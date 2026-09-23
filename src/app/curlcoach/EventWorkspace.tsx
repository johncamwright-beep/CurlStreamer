"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deficiencies,
  executions,
  report,
  roster,
  shotTypes,
  turns,
  type RosterEntry,
  type Shot,
  type State,
} from "@/lib/curlcoach/model";
import {
  eventShots,
  family,
  gameShots,
  grouped,
  matrix,
  outcomePercent,
  workbookCategoryPercent,
  type CoachEvent,
  type CoachGame,
  type Workspace,
} from "@/lib/curlcoach/event";
import {
  teamScoreStatistics,
  situationWins,
  type rate,
} from "@/lib/curlcoach/score-statistics";
import { updateWorkspaceState } from "@/lib/curlcoach/workspace-state";
import { eventLevels } from "@/lib/team-hierarchy";
import { preferredGame } from "@/lib/current-game";
import CoachLab, { turnLabel } from "./CoachLab";
import ReviewSummary from "./ReviewSummary";
import MissAnalysis from "./MissAnalysis";
import ScoringWakeLock from "./ScoringWakeLock";
import "./coach.css";
const pages = [
  "Scoring",
  "Shot breakdown",
  "End-by-end scores",
  "Team statistics",
  "Game analysis",
  "Miss analysis",
] as const;
type Page = (typeof pages)[number];
const slug = (page: string) => page.toLowerCase().replaceAll(" ", "-");
const pct = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
const outcome = (shots: Shot[], deficiency: string) => {
  const count = shots.filter(
    (shot) => !shot.excluded && shot.deficiency === deficiency,
  ).length;
  return `${count} · ${pct(outcomePercent(shots, deficiency))}`;
};
function Summary({ shots }: { shots: Shot[] }) {
  const r = report(shots);
  return (
    <div className="event-metrics event-shot-metrics">
      <div>
        <span>Shooting</span>
        <strong>{pct(r.percent)}</strong>
      </div>
      <div>
        <span>Graded / shots</span>
        <strong>
          {r.scored} / {r.attempts}
        </strong>
      </div>
      <div>
        <span>Ungraded</span>
        <strong>{r.missing}</strong>
      </div>
      <div>
        <span>Excluded</span>
        <strong>{r.excluded}</strong>
      </div>
    </div>
  );
}
function Table({
  title,
  columns,
  rows,
  shotSelector = false,
  selectorLabel = "Shot type",
  optionLabel,
}: {
  title: string;
  columns: readonly string[];
  rows: { label: string; values: (string | number)[] }[];
  shotSelector?: boolean;
  selectorLabel?: string;
  optionLabel?: (label: string) => string;
}) {
  const [shot, setShot] = useState("");
  const selectedShot = rows.some((row) => row.label === shot)
    ? shot
    : (rows[0]?.label ?? "");
  const visibleRows = shotSelector
    ? rows.filter((row) => row.label === selectedShot)
    : rows;
  return (
    <section className="event-card">
      <h3>{title}</h3>
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
function ShootingTable({ shots }: { shots: Shot[] }) {
  const groups = [
    { label: "Overall", ...report(shots) },
    ...grouped(shots, ["Draws", "Hits"], family),
    ...grouped(shots, shotTypes, (s) => s.type),
  ];
  return (
    <Table
      title="Shooting by shot type"
      shotSelector
      columns={[
        "Recorded",
        "Graded",
        "Missing",
        "Excluded",
        "Shooting",
        "Workbook category %",
      ]}
      rows={groups.map((r) => ({
        label: r.label,
        values: [
          r.attempts,
          r.scored,
          r.missing,
          r.excluded,
          pct(r.percent),
          pct(
            r.label === "Overall"
              ? r.percent
              : workbookCategoryPercent(
                  shots.filter(
                    (s) => family(s) === r.label || s.type === r.label,
                  ),
                ),
          ),
        ],
      }))}
    />
  );
}
function ResultTable({
  shots,
  title,
  types,
  aggregateLabel,
}: {
  shots: Shot[];
  title: string;
  types: readonly string[];
  aggregateLabel: string;
}) {
  return (
    <Table
      title={title}
      shotSelector
      columns={[...deficiencies, "Shooting"]}
      rows={grouped(shots, types, (s) => s.type, aggregateLabel).map((r) => {
        const category = shots.filter((s) =>
          r.label === aggregateLabel
            ? s.type !== null && types.includes(s.type)
            : s.type === r.label,
        );
        return {
          label: r.label,
          values: [
            ...deficiencies.map((deficiency) => outcome(category, deficiency)),
            pct(r.percent),
          ],
        };
      })}
    />
  );
}
function TurnDeficiencyTable({
  shots,
  title = "Turn / deficiency",
}: {
  shots: Shot[];
  title?: string;
}) {
  return (
    <Table
      title={title}
      shotSelector
      selectorLabel="Turn / target"
      optionLabel={(label) =>
        label === "All Turns" ? label : turnLabel(label)
      }
      columns={[...deficiencies, "Shooting"]}
      rows={grouped(
        shots,
        turns,
        (s) => s.turn,
        "All Turns",
        () => true,
      ).map((r) => {
        const category = shots.filter((s) =>
          r.label === "All Turns" ? true : s.turn === r.label,
        );
        return {
          label: r.label,
          values: [
            ...deficiencies.map((deficiency) => outcome(category, deficiency)),
            pct(r.percent),
          ],
        };
      })}
    />
  );
}
function DataTables({
  shots,
  summary = true,
}: {
  shots: Shot[];
  summary?: boolean;
}) {
  return (
    <>
      {summary && <Summary shots={shots} />}
      <TurnDeficiencyTable shots={shots} />
      <Table
        title="Shot type performance"
        shotSelector
        columns={executions}
        rows={[
          ...matrix(
            shots,
            ["Draws", "Hits"],
            executions,
            family,
            (s) => s.execution,
          ),
          ...matrix(
            shots,
            ["Total"],
            executions,
            () => "Total",
            (s) => s.execution,
          ),
        ]}
      />
      <Table
        title="Total execution"
        columns={["Count", "Share of recorded execution"]}
        rows={executions.map((label) => {
          const count = shots.filter(
            (s) => !s.excluded && s.execution === label,
          ).length;
          const total = shots.filter((s) => !s.excluded && s.execution).length;
          return {
            label,
            values: [count, pct(total ? (count / total) * 100 : null)],
          };
        })}
      />
      <ResultTable
        title="Result / draw type"
        shots={shots}
        types={shotTypes.slice(0, 5)}
        aggregateLabel="All Draws"
      />
      <ResultTable
        title="Result / hit type"
        shots={shots}
        types={shotTypes.slice(5)}
        aggregateLabel="All Hits"
      />
      <ShootingTable shots={shots} />
    </>
  );
}
function PlayerAnalysis({
  shots,
  games,
  player,
}: {
  shots: Shot[];
  games: CoachGame[];
  player: string;
}) {
  const filtered = (game: CoachGame) =>
    gameShots(game).filter((s) => player === "all" || s.playerId === player);
  const eligible = shots.filter((s) => !s.excluded);
  return (
    <>
      <Summary shots={shots} />
      <section className="event-card">
        <h3>Shooting by game</h3>
        <div className="event-bars">
          {games.map((game) => {
            const r = report(filtered(game));
            return (
              <div key={game.id}>
                <span>{game.label}</span>
                <div className="event-bar-track">
                  <div style={{ width: `${r.percent ?? 0}%` }} />
                </div>
                <strong>{pct(r.percent)}</strong>
                <small>{r.scored} graded</small>
              </div>
            );
          })}
        </div>
      </section>
      <ShootingTable shots={shots} />
      <Table
        title="Execution distribution"
        columns={["Count", "%"]}
        rows={executions.map((label) => {
          const n = eligible.filter((s) => s.execution === label).length;
          const total = eligible.filter((s) => s.execution !== null).length;
          return { label, values: [n, pct(total ? (n / total) * 100 : null)] };
        })}
      />
      <div className="event-two">
        {["Draws", "Hits"].map((f) => (
          <Table
            key={f}
            title={`${f} deficiencies`}
            columns={["Count", "%"]}
            rows={deficiencies.map((label) => {
              const pool = eligible.filter(
                (s) => family(s) === f && s.deficiency !== null,
              );
              const n = pool.filter((s) => s.deficiency === label).length;
              return {
                label,
                values: [n, pct(pool.length ? (n / pool.length) * 100 : null)],
              };
            })}
          />
        ))}
      </div>
      <Table
        title="Turn / target frequency"
        columns={["Count", "Shooting"]}
        rows={grouped(eligible, turns, (s) => s.turn).map((r) => ({
          label: r.label,
          values: [r.attempts, pct(r.percent)],
        }))}
      />
      <Table
        title="Shot-by-shot execution"
        shotSelector
        columns={executions}
        rows={matrix(
          shots,
          shotTypes,
          executions,
          (s) => s.type,
          (s) => s.execution,
        )}
      />
      <div className="event-two">
        {["Draws", "Hits"].map((f) => (
          <Table
            key={f}
            title={`${f} execution / deficiency`}
            columns={deficiencies}
            rows={matrix(
              shots.filter((s) => family(s) === f),
              executions,
              deficiencies,
              (s) => s.execution,
              (s) => s.deficiency,
            )}
          />
        ))}
      </div>
      <div className="event-two">
        {["Draws", "Hits"].map((f) => (
          <TurnDeficiencyTable
            key={f}
            title={`Turn analysis · ${f}`}
            shots={shots.filter((s) => family(s) === f)}
          />
        ))}
      </div>
    </>
  );
}
function Scoreboard({
  event,
  singleGame,
}: {
  event: CoachEvent;
  singleGame: boolean;
}) {
  const [enteringEnd, setEnteringEnd] = useState("final");
  const available = event.games.filter(
    (g) => g.scoreboardAvailable && g.ends.length,
  );
  if (!available.length)
    return (
      <section className="event-card" role="status">
        <h3>No line scores available</h3>
        <p>
          {event.games.length
            ? "No CurlStreamer end scores are available for the selected games. Record the ends in the game's scorer, then refresh here."
            : "No games match these filters."}
        </p>
      </section>
    );
  const us = teamScoreStatistics(available),
    them = teamScoreStatistics(available, true);
  const formatRate = (r: ReturnType<typeof rate>) =>
    r.total
      ? pct(r.percent) + " · " + r.count + " / " + r.total + " ends"
      : "— · No eligible ends";
  const comparison = (
    keys: { key: Exclude<keyof typeof us, "unknownHammer">; label: string }[],
  ) =>
    keys.map(({ key, label }) => ({
      label,
      values: [formatRate(us[key]), formatRate(them[key])],
    }));
  const maxEnd = Math.max(
    ...available.map((g) => g.scheduledEnds),
    ...available.flatMap((g) => g.ends.map((e) => e.end)),
  );
  const endSelection =
    enteringEnd === "final" || Number(enteringEnd) <= maxEnd
      ? enteringEnd
      : "final";
  const wins = situationWins(
    available,
    endSelection === "final" ? "final" : Number(endSelection),
  );
  return (
    <>
      {available.length < event.games.length && (
        <p role="status">
          Line scores are available for {available.length} of{" "}
          {event.games.length} selected games. Games without line scores are
          excluded from these statistics.
        </p>
      )}
      <div className="event-metrics event-shot-metrics">
        <div>
          <span>Games</span>
          <strong>{available.length}</strong>
        </div>
        <div>
          <span>Ends</span>
          <strong>{available.reduce((n, g) => n + g.ends.length, 0)}</strong>
        </div>
        <div>
          <span>Points for</span>
          <strong>
            {available.reduce(
              (n, g) => n + g.ends.reduce((sum, e) => sum + e.us, 0),
              0,
            )}
          </strong>
        </div>
        <div>
          <span>Against</span>
          <strong>
            {available.reduce(
              (n, g) => n + g.ends.reduce((sum, e) => sum + e.them, 0),
              0,
            )}
          </strong>
        </div>
      </div>
      <p className="score-stat-caption">
        {singleGame ? "Selected game" : "All selected games combined"} · Each
        percentage shows matching ends / eligible ends.
      </p>
      {us.unknownHammer > 0 && (
        <p role="status">
          Hammer is unknown for {us.unknownHammer} recorded ends. Those ends
          count toward totals and overall blanks, but not hammer statistics.
        </p>
      )}
      <Table
        title="With hammer"
        columns={["Our team", "Opponents"]}
        rows={comparison([
          { key: "scoring", label: "Score at least 1 point" },
          { key: "multiple", label: "Score 2 or more points" },
          { key: "blankWith", label: "Blank the end (0–0)" },
          { key: "stolenAgainst", label: "Allow a steal" },
        ])}
      />
      <Table
        title="Without hammer"
        columns={["Our team", "Opponents"]}
        rows={comparison([
          { key: "steals", label: "Steal at least 1 point" },
          { key: "forceOne", label: "Hold opponent to 1 point" },
          { key: "blankWithout", label: "Blank the end (0–0)" },
          { key: "concedeMultiple", label: "Allow 2 or more points" },
        ])}
      />
      <Table
        title="All ends"
        columns={["Combined"]}
        rows={[{ label: "Blank ends (0–0)", values: [formatRate(us.blanks)] }]}
      />
      <section className="event-card score-situations">
        <h3>Winning from a game situation</h3>
        <label className="event-shot-selector">
          Entering end
          <select
            aria-label="Entering end"
            value={endSelection}
            onChange={(e) => setEnteringEnd(e.target.value)}
          >
            <option value="final">Final scheduled end</option>
            {Array.from({ length: maxEnd }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                End {i + 1}
              </option>
            ))}
          </select>
        </label>
        <p className="score-stat-caption">
          Completed games only. Score and hammer are measured before the
          selected end; wins use the final recorded score, including extra ends.
          Games that ended earlier are excluded.
        </p>
        {wins.length ? (
          <Table
            title="Win rate by starting situation"
            columns={["Win rate", "Wins / games", "Losses", "Ties"]}
            rows={wins.map((r) => ({
              label:
                (r.difference === 0
                  ? "Tied"
                  : (r.difference > 0 ? "Up " : "Down ") +
                    Math.abs(r.difference) +
                    (Math.abs(r.difference) === 4 ? "+" : "")) +
                " · " +
                (r.hammer ? "With hammer" : "Without hammer"),
              values: [
                pct(r.percent),
                r.wins + " / " + r.total,
                r.losses,
                r.ties,
              ],
            }))}
          />
        ) : (
          <p role="status">
            No completed games with a known score and hammer reached this end.
          </p>
        )}
      </section>
      {singleGame &&
        available.map((game) => (
          <Table
            key={game.id}
            title="Game scoreboard"
            columns={game.ends.map((e) => String(e.end)).concat("Total")}
            rows={[
              {
                label: game.teamName,
                values: game.ends
                  .map((e) => e.us)
                  .concat(game.ends.reduce((n, e) => n + e.us, 0)),
              },
              {
                label: game.opponent,
                values: game.ends
                  .map((e) => e.them)
                  .concat(game.ends.reduce((n, e) => n + e.them, 0)),
              },
            ]}
          />
        ))}
    </>
  );
}
export default function EventWorkspace({
  unlocked,
  mode = "lab",
  initialEventId,
}: {
  unlocked: boolean;
  mode?: "lab" | "streamer";
  initialEventId?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [filtersTarget, setFiltersTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const drafts = useRef(
    new Map<string, { draft: Shot; editing: string | null; current?: Shot }>(),
  );
  const [platformAdmin, setPlatformAdmin] = useState(false);
  useEffect(() => {
    if (mode !== "streamer") return;
    const controller = new AbortController();
    void fetch("/api/account/navigation", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const account = response.ok ? await response.json() : null;
        if (!controller.signal.aborted)
          setPlatformAdmin(account?.platformAdmin === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlatformAdmin(false);
      });
    return () => controller.abort();
  }, [mode]);
  const [open, setOpen] = useState(unlocked),
    [view, setView] = useState<Page>("Scoring"),
    [source, setSource] = useState<"sample" | "streamer">(
      mode === "streamer" ? "streamer" : "sample",
    ),
    [eventId, setEventId] = useState(
      initialEventId ?? (mode === "streamer" ? "" : "shorty-example"),
    ),
    [gameId, setGameId] = useState(""),
    [player, setPlayer] = useState("all"),
    [analysisGame, setAnalysisGame] = useState("all"),
    [competitionLevel, setCompetitionLevel] = useState("all"),
    [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (mode !== "streamer" && query.get("source") === "streamer")
      setSource("streamer");
    if (!initialEventId && query.get("event")) setEventId(query.get("event")!);
    if (query.get("game")) setGameId(query.get("game")!);
    const read = () =>
      setView(
        pages.find(
          (p) =>
            slug(p) ===
            ({
              "data-tables": "shot-breakdown",
              team: "team-statistics",
              "scoreboard-analysis": "end-by-end-scores",
            }[location.hash.slice(1)] ?? location.hash.slice(1)),
        ) ?? "Scoring",
      );
    read();
    setSelectionReady(true);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [initialEventId, mode]);
  const [seasonId, setSeasonId] = useState("");
  const [statsEventId, setStatsEventId] = useState("");
  const [statsData, setStatsData] = useState<Workspace | null>(null);
  const [statsError, setStatsError] = useState("");
  // Component-local only: never persist private coaching data across accounts.
  const savedStates = useRef(new Map<string, State>());
  const refreshSequence = useRef(0);
  const statistics = view !== "Scoring";
  const selectedSeason = seasonId || data?.event.seasonId || "unassigned";
  const selectedEvent = statsEventId || data?.event.id || "all";
  const seasonReady = statsData?.event.seasonId === selectedSeason;
  const eventReady =
    data?.event.seasonId === selectedSeason && data?.event.id === selectedEvent;
  // Event statistics are already in the scoring response. Don't hold them up
  // while the rest of the season loads for the All events selector.
  const analysisData = seasonReady ? statsData : eventReady ? data : null;
  const statsReady = !!analysisData;
  const hasData = !!data;
  useEffect(() => {
    if (!open || !statistics || !hasData || seasonReady) return;
    const controller = new AbortController();
    setStatsError("");
    void fetch(
      "/api/curlcoach/workspace?" +
        new URLSearchParams({ source, seasonId: selectedSeason }),
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Statistics unavailable");
        if (!controller.signal.aborted) {
          let current: Workspace = result;
          for (const state of savedStates.current.values())
            current = updateWorkspaceState(current, state);
          setStatsData(current);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setStatsError(
            error instanceof Error ? error.message : "Statistics unavailable",
          );
      });
    return () => controller.abort();
  }, [open, statistics, hasData, seasonReady, selectedSeason, source]);
  const refresh = useCallback(
    async (signal?: AbortSignal, resetStatistics = true) => {
      const sequence = ++refreshSequence.current;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(
          `/api/curlcoach/workspace?source=${source}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ""}`,
          { cache: "no-store", signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (signal?.aborted || sequence !== refreshSequence.current) return;
        let current: Workspace = result;
        for (const state of savedStates.current.values())
          current = updateWorkspaceState(current, state);
        setData(current);
        setStatsData((previous) =>
          !resetStatistics &&
          previous?.event.organizationId === current.event.organizationId &&
          previous.event.source === current.event.source
            ? current.event.games.reduce(
                (workspace, game) =>
                  updateWorkspaceState(workspace, game.state),
                previous,
              )
            : null,
        );
        setGameId((current) =>
          result.event.games.some((g: CoachGame) => g.id === current)
            ? current
            : (preferredGame<CoachGame>(result.event.games)?.id ?? ""),
        );
      } catch (e) {
        if (!signal?.aborted && sequence === refreshSequence.current) {
          setData(null);
          setStatsData(null);
          setError(e instanceof Error ? e.message : "Event unavailable");
        }
      } finally {
        if (!signal?.aborted && sequence === refreshSequence.current)
          setBusy(false);
      }
    },
    [source, eventId],
  );
  useEffect(() => {
    if (!open || !selectionReady) return;
    const controller = new AbortController();
    void refresh(controller.signal, false);
    return () => controller.abort();
  }, [open, selectionReady, refresh]);
  async function unlock(form: FormData) {
    setBusy(true);
    try {
      const response = await fetch("/api/curlcoach/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: form.get("key") }),
      });
      if (!response.ok) throw new Error("The local lab key was not accepted.");
      setOpen(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to unlock");
    } finally {
      setBusy(false);
    }
  }
  const event = data?.event,
    game = event?.games.find((g) => g.id === gameId),
    statsGames = statsReady
      ? (analysisData?.event.games ?? [])
          .filter((g) => selectedEvent === "all" || g.eventId === selectedEvent)
          .filter(
            (g) =>
              competitionLevel === "all" ||
              (g.competitionLevel ?? "unrecorded") === competitionLevel,
          )
          .map((g) => ({
            ...g,
            label:
              selectedEvent === "all"
                ? (analysisData?.catalog.find((e) => e.id === g.eventId)
                    ?.name ?? "Single games") +
                  " · " +
                  g.label
                : g.label,
          }))
      : [],
    analysisGames = statsGames.filter(
      (g) => analysisGame === "all" || g.id === analysisGame,
    ),
    analysisPlayers = [
      ...new Map(
        analysisGames
          .flatMap<RosterEntry>((g) => g.roster ?? g.state.roster ?? roster)
          .map((p) => [p.id, p]),
      ).values(),
    ],
    all = event
      ? eventShots({ ...event, games: analysisGames }).filter((s) =>
          analysisGames.some((g) => g.id === s.gameId),
        )
      : [],
    selected = all.filter((s) => player === "all" || s.playerId === player);
  function remember(source: string, event: string, game = "") {
    history.replaceState(
      null,
      "",
      `${location.pathname}?${new URLSearchParams({ source, event, game })}${location.hash}`,
    );
  }
  function saved(state: State) {
    savedStates.current.set(state.gameId, state);
    setStatsData((current) =>
      current ? updateWorkspaceState(current, state) : current,
    );
    setData((current) =>
      current ? updateWorkspaceState(current, state) : current,
    );
  }

  return (
    <div className="coach-workspace">
      <aside className="event-sidebar">
        <div className="coach-topbar">
          <button
            type="button"
            className="coach-menu-toggle"
            aria-label="Shot Tracker menu"
            aria-expanded={menuOpen}
            aria-controls="coach-menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">☰</span> {view}
          </button>
          <div
            ref={setActionsTarget}
            hidden={view !== "Scoring"}
            className="coach-session-actions"
            role="group"
            aria-label="Scoring session actions"
          />
        </div>
        <div
          id="coach-menu"
          hidden={!menuOpen}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMenuOpen(false);
              document
                .querySelector<HTMLButtonElement>(".coach-menu-toggle")
                ?.focus();
            }
          }}
        >
          <a className="event-brand" href="#scoring">
            SHOT <span>TRACKER</span>
          </a>
          <nav aria-label="Shot Tracker pages">
            {pages.map((page) => (
              <a
                href={`#${slug(page)}`}
                onClick={() => setMenuOpen(false)}
                aria-current={view === page ? "page" : undefined}
                key={page}
              >
                {page}
              </a>
            ))}
          </nav>
          <div className="event-sidebar-footer">
            {mode === "streamer" ? (
              <nav aria-label="Account">
                <a href="/account">Account &amp; Settings</a>
                {platformAdmin && <a href="/admin">Platform administration</a>}
              </nav>
            ) : (
              <>
                Local development
                <br />
                Add-on disabled in production
              </>
            )}
          </div>
        </div>
      </aside>
      <main className="event-main">
        <header className="event-header">
          <div>
            <h1>{view}</h1>
          </div>
          {open && (
            <button
              aria-label="Refresh event"
              title="Refresh event"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <span aria-hidden="true">↻</span>
            </button>
          )}
          {open && (
            <div className="event-selectors event-filter-bar">
              {mode === "lab" && (
                <label>
                  Data source
                  <select
                    value={source}
                    onChange={(e) => {
                      setData(null);
                      setStatsData(null);
                      savedStates.current.clear();
                      setSource(e.target.value as typeof source);
                      remember(
                        e.target.value,
                        e.target.value === "sample" ? "shorty-example" : "",
                      );
                      setEventId(
                        e.target.value === "sample" ? "shorty-example" : "",
                      );
                    }}
                  >
                    <option value="sample">Local examples</option>
                    <option value="streamer">
                      Streamer · local connection
                    </option>
                  </select>
                </label>
              )}
              {statistics ? (
                <>
                  <label>
                    Season
                    <select
                      value={selectedSeason}
                      disabled={!data}
                      onChange={(e) => {
                        setSeasonId(e.target.value);
                        setStatsEventId("all");
                        setAnalysisGame("all");
                        setPlayer("all");
                      }}
                    >
                      {(data?.seasons ?? []).map((season) => (
                        <option key={season.id} value={season.id}>
                          {season.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Event
                    <select
                      value={selectedEvent}
                      disabled={!data}
                      onChange={(e) => {
                        setStatsEventId(e.target.value);
                        setAnalysisGame("all");
                        setPlayer("all");
                      }}
                    >
                      <option value="all">All events</option>
                      {(statsData?.catalog ?? data?.catalog ?? [])
                        .filter(
                          (e) =>
                            e.seasonId === selectedSeason ||
                            e.id === "standalone",
                        )
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : (
                <label>
                  Event
                  <select
                    value={event?.id ?? eventId}
                    disabled={!data}
                    onChange={(e) => {
                      setData(null);
                      setEventId(e.target.value);
                      setAnalysisGame("all");
                      setPlayer("all");
                      remember(source, e.target.value);
                    }}
                  >
                    {data?.catalog.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {statistics && (
                <label>
                  Competition
                  <select
                    aria-label="Competition level"
                    title="Opponent’s level for the game’s season"
                    value={competitionLevel}
                    onChange={(e) => {
                      setCompetitionLevel(e.target.value);
                      setAnalysisGame("all");
                      setPlayer("all");
                    }}
                  >
                    <option value="all">All levels</option>
                    {eventLevels.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                    <option value="unrecorded">Not recorded</option>
                  </select>
                </label>
              )}
              {view === "Scoring" && event && (
                <label className="event-game-picker">
                  Game
                  <select
                    value={gameId}
                    onChange={(e) => {
                      setGameId(e.target.value);
                      remember(source, event.id, e.target.value);
                    }}
                  >
                    {event.games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label} · vs {g.opponent}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {view !== "Scoring" && (
                <>
                  <label>
                    Game
                    <select
                      value={analysisGame}
                      onChange={(e) => {
                        setAnalysisGame(e.target.value);
                        setPlayer("all");
                      }}
                    >
                      <option value="all">All games</option>
                      {statsGames.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label} · vs {g.opponent}
                        </option>
                      ))}
                    </select>
                  </label>
                  {view !== "End-by-end scores" && (
                    <label>
                      Team / player
                      <select
                        value={player}
                        onChange={(e) => setPlayer(e.target.value)}
                      >
                        <option value="all">Whole team</option>
                        {analysisPlayers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              <div ref={setFiltersTarget} className="event-extra-filters" />
            </div>
          )}
        </header>
        <p role="status" aria-live="polite">
          {statistics && !statsReady && !error
            ? statsError || "Loading season statistics…"
            : busy
              ? "Loading event…"
              : error || statsError}
        </p>
        {!open ? (
          <form className="event-card" action={unlock}>
            <h2>Unlock your local session</h2>
            <label>
              Local lab key
              <input type="password" name="key" required autoComplete="off" />
            </label>
            <button disabled={busy}>Unlock lab</button>
          </form>
        ) : !event ? (
          <section className="event-card">
            <h2>Event data is unavailable</h2>
            <p>{error || "Loading the selected event."}</p>
            <p>
              {mode === "streamer"
                ? "The selected Streamer game is unavailable to this coach."
                : "Use Local examples to explore the seven-game Shorty Jenkins workspace."}
            </p>
          </section>
        ) : (
          <>
            {event.source === "sample" && <p>SYNTHETIC EXAMPLE</p>}
            <div hidden={view !== "Scoring"}>
              <ScoringWakeLock active={open && !!game && view === "Scoring"} />
            </div>

            <div hidden={view !== "Scoring"}>
              {game ? (
                <CoachLab
                  key={`${source}:${event.id}:${game.id}`}
                  unlocked
                  actionsTarget={actionsTarget}
                  resume={drafts.current.get(
                    source + ":" + event.id + ":" + game.id,
                  )}
                  onResume={(value) =>
                    drafts.current.set(
                      source + ":" + event.id + ":" + game.id,
                      value,
                    )
                  }
                  context={{
                    source,
                    eventId: event.id,
                    gameId: game.id,
                    roster: game.roster ?? game.state.roster,
                    initialState: game.state,
                    broadcastReview: game.broadcastReview,
                    onSaved: saved,
                  }}
                />
              ) : (
                <p>No games in this event.</p>
              )}
            </div>

            {view === "Miss analysis" && (
              <MissAnalysis
                filtersTarget={filtersTarget}
                shots={selected}
                games={analysisGames}
                players={analysisPlayers}
              />
            )}
            {view === "Shot breakdown" && <DataTables shots={selected} />}
            {view === "Team statistics" && (
              <>
                <PlayerAnalysis
                  shots={selected}
                  games={analysisGames}
                  player={player}
                />
              </>
            )}
            {view === "Game analysis" &&
              (analysisGames.length ? (
                <>
                  <Summary shots={selected} />
                  <ReviewSummary
                    shots={selected}
                    players={analysisPlayers.filter(
                      (p) => player === "all" || p.id === player,
                    )}
                  />
                  <Table
                    title="Player performance"
                    columns={["Graded", "Missing", "Shooting"]}
                    rows={analysisPlayers
                      .filter((p) => player === "all" || p.id === player)
                      .map((p) => {
                        const r = report(
                          selected.filter((s) => s.playerId === p.id),
                        );
                        return {
                          label: p.name,
                          values: [r.scored, r.missing, pct(r.percent)],
                        };
                      })}
                  />
                  <Table
                    title="End performance"
                    shotSelector
                    selectorLabel="End"
                    columns={["Recorded", "Graded", "Shooting"]}
                    rows={grouped(
                      selected,
                      Array.from(
                        {
                          length: Math.max(
                            8,
                            ...analysisGames.map((g) => g.scheduledEnds),
                            ...selected.map((s) => s.end),
                          ),
                        },
                        (_, i) => String(i + 1),
                      ),
                      (s) => String(s.end),
                      "All Ends",
                    ).map((r) => ({
                      label:
                        r.label === "All Ends" ? r.label : `End ${r.label}`,
                      values: [r.attempts, r.scored, pct(r.percent)],
                    }))}
                  />
                  <DataTables shots={selected} summary={false} />
                </>
              ) : (
                <p>No games in this event.</p>
              ))}
            {view === "End-by-end scores" &&
              (analysisGames.length ? (
                <Scoreboard
                  event={{ ...event, games: analysisGames }}
                  singleGame={analysisGame !== "all"}
                />
              ) : (
                <p>No games in this event.</p>
              ))}
          </>
        )}
      </main>
    </div>
  );
}
