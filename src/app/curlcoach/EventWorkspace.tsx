"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  roster,
  shotTypes,
  turns,
  type RosterEntry,
  type State,
} from "@/lib/curlcoach/model";
import {
  eventShots,
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
import {
  scheduledCoachGame,
  coachingReadOnlyReason,
  coachingClosed,
} from "@/lib/curlcoach/game-selection";
import {
  emptyResumeStore,
  readResumeStore,
  writeResumeStore,
  rememberResume,
  reconcileResume,
  resumeId,
  validResumeSnapshot,
  type ResumeScope,
  type ResumeStore,
  type TrackerResume,
} from "@/lib/curlcoach/resume-storage";
import CoachLab, { turnLabel } from "./CoachLab";

import AnalysisPanels from "./AnalysisPanels";
import Table from "./AnalysisTable";
import {
  defaultShotFilters,
  filterAnalysisShots,
} from "@/lib/curlcoach/analysis";
import EventReportLibrary from "./EventReportLibrary";
import ScoringWakeLock from "./ScoringWakeLock";
import "./coach.css";
const pages = [
  "Charting",
  "Shot performance",
  "Miss analysis",
  "Game analysis",
  "Event reports",
] as const;
type Page = (typeof pages)[number];
const slug = (page: string) => page.toLowerCase().replaceAll(" ", "-");
const pct = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
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
  accountScope,
}: {
  unlocked: boolean;
  mode?: "lab" | "streamer";
  initialEventId?: string;
  accountScope?: ResumeScope;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shotFilters, setShotFilters] = useState(defaultShotFilters);
  const drafts = useRef(new Map<string, TrackerResume>());
  const resumeStore = useRef<ResumeStore | null>(null);

  const [resumeResetKey, setResumeResetKey] = useState(0);
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
    [view, setView] = useState<Page>("Charting"),
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
  const chooseScheduledOnOpen = useRef(mode === "streamer");
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setScheduleNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    drafts.current.clear();
    savedStates.current.clear();
    setData(null);
    setStatsData(null);
    let stored: ResumeStore | null = accountScope
      ? emptyResumeStore(accountScope)
      : null;
    try {
      if (accountScope)
        stored = readResumeStore(window.localStorage, accountScope);
    } catch {
      // Storage may be unavailable; in-memory tracking still works.
    }
    resumeStore.current = stored;
    if (mode !== "streamer" && query.get("source") === "streamer")
      setSource("streamer");
    if (!initialEventId && query.get("event")) setEventId(query.get("event")!);
    if (query.get("game")) setGameId(query.get("game")!);
    else if (
      !query.get("event") &&
      !initialEventId &&
      stored?.active &&
      (mode !== "streamer" ||
        Date.now() - stored.active.updatedAt < 4 * 3600000)
    ) {
      setSource(stored.active.source);
      setEventId(stored.active.eventId);
      setGameId(stored.active.gameId);
    }
    const read = () =>
      setView(
        pages.find(
          (p) =>
            slug(p) ===
            ({
              scoring: "charting",
              "data-tables": "shot-performance",
              "shot-breakdown": "shot-performance",
              team: "shot-performance",
              "team-statistics": "shot-performance",
              "scoreboard-analysis": "game-analysis",
              "end-by-end-scores": "game-analysis",
            }[location.hash.slice(1)] ?? location.hash.slice(1)),
        ) ?? "Charting",
      );
    read();
    setSelectionReady(true);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [
    initialEventId,
    mode,
    accountScope?.actorId,
    accountScope?.organizationId,
  ]);
  const [seasonId, setSeasonId] = useState("");
  const [statsEventId, setStatsEventId] = useState("");
  const [statsData, setStatsData] = useState<Workspace | null>(null);
  const [statsError, setStatsError] = useState("");
  // Component-local only: never persist private coaching data across accounts.
  const savedStates = useRef(new Map<string, State>());
  const refreshSequence = useRef(0);
  const statistics = view !== "Charting" && view !== "Event reports";
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
        for (const loadedGame of current.event.games) {
          const identity = {
            source: current.event.source,
            eventId: current.event.id,
            gameId: loadedGame.id,
          };
          const snapshot = resumeStore.current?.drafts.find(
            (entry) => resumeId(entry) === resumeId(identity),
          );
          if (snapshot) {
            const reconciled = reconcileResume(
              snapshot,
              loadedGame.state,
              accountScope,
            );
            if (reconciled) drafts.current.set(resumeId(identity), reconciled);
            else drafts.current.delete(resumeId(identity));
          }
        }
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
        const recommended = scheduledCoachGame(current.event.games);
        const scheduledDefault =
          chooseScheduledOnOpen.current && recommended?.scheduledStart
            ? recommended.id
            : undefined;
        chooseScheduledOnOpen.current = false;
        setGameId(
          (current) =>
            scheduledDefault ??
            (result.event.games.some((g: CoachGame) => g.id === current)
              ? current
              : (preferredGame<CoachGame>(result.event.games)?.id ?? "")),
        );
      } catch (e) {
        if (!signal?.aborted && sequence === refreshSequence.current) {
          setError(e instanceof Error ? e.message : "Event unavailable");
        }
      } finally {
        if (!signal?.aborted && sequence === refreshSequence.current)
          setBusy(false);
      }
    },
    [source, eventId, accountScope?.actorId, accountScope?.organizationId],
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
    playerShots = all.filter((s) => player === "all" || s.playerId === player),
    selected = filterAnalysisShots(playerShots, analysisGames, shotFilters);
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
  function retainDraft(
    value: TrackerResume,
    activelyTracking = false,
    stateRevision?: number,
  ) {
    if (!event || !game) return;
    const snapshot = validResumeSnapshot({
      ...value,
      source,
      eventId: event.id,
      gameId: game.id,
      stateRevision:
        stateRevision ?? game.state.revision ?? game.state.events.length,
      updatedAt: Date.now(),
    });
    if (!snapshot) return;
    drafts.current.set(resumeId(snapshot), value);
    if (resumeStore.current) {
      resumeStore.current = rememberResume(
        resumeStore.current,
        snapshot,
        activelyTracking,
      );
      try {
        writeResumeStore(window.localStorage, resumeStore.current);
      } catch {
        // Tracking is available even when browser storage is disabled.
      }
    }
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
          <a className="event-brand" href="#charting">
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
                    value={eventId || event?.id}
                    disabled={!data}
                    onChange={(e) => {
                      setBusy(true);
                      setError("");
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
              {view === "Charting" && event && (
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
                        {coachingClosed(g) ? " · Closed — review only" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {view !== "Charting" && view !== "Event reports" && (
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
                  {
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
                  }
                </>
              )}
            </div>
          )}
          {statistics && (
            <details className="event-card analysis-more">
              <summary>More filters</summary>
              <div className="event-filter-bar">
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
                {(
                  [
                    ["type", "Shot type", ["Draws", "Hits", ...shotTypes]],
                    ["turn", "Turn / target", [...turns]],
                    [
                      "end",
                      "End",
                      Array.from(
                        {
                          length: Math.max(
                            10,
                            ...analysisGames.map((g) => g.scheduledEnds),
                            ...all.map((s) => s.end),
                          ),
                        },
                        (_, i) => String(i + 1),
                      ),
                    ],
                    ["hammer", "Hammer before end", ["with", "without"]],
                    [
                      "margin",
                      "Score difference before end",
                      ["4", "3", "2", "1", "0", "-1", "-2", "-3", "-4"],
                    ],
                  ] as const
                ).map(([key, label, options]) => (
                  <label key={key}>
                    {label}
                    <select
                      value={shotFilters[key]}
                      onChange={(e) =>
                        setShotFilters((current) => ({
                          ...current,
                          [key]: e.target.value,
                        }))
                      }
                    >
                      <option value="all">All</option>
                      {options.map((value) => (
                        <option key={value} value={value}>
                          {key === "margin"
                            ? Number(value) === 0
                              ? "Tied"
                              : (Number(value) > 0 ? "Up " : "Down ") +
                                Math.abs(Number(value)) +
                                (Math.abs(Number(value)) === 4 ? "+" : "")
                            : value}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  onClick={() => {
                    setShotFilters(defaultShotFilters);
                    setCompetitionLevel("all");
                  }}
                >
                  Reset more filters
                </button>
              </div>
              <p className="score-stat-caption">
                Shot filters use the score and hammer at the start of the end.
                Unknown situations are excluded when filtered.
              </p>
            </details>
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
        ) : !event || (eventId && event.id !== eventId) ? (
          <section className="event-card">
            <h2>{error ? "Event data is unavailable" : "Loading event…"}</h2>
            {error && (
              <>
                <p>{error}</p>
                <p>
                  {mode === "streamer"
                    ? "The selected Streamer game is unavailable to this coach."
                    : "Use Local examples to explore the seven-game Shorty Jenkins workspace."}
                </p>
              </>
            )}
          </section>
        ) : (
          <>
            {event.source === "sample" && <p>SYNTHETIC EXAMPLE</p>}
            {view === "Event reports" &&
              (mode === "streamer" ? (
                <EventReportLibrary />
              ) : (
                <p>
                  AI reports are available for completed events in a connected
                  Shot Tracker account.
                </p>
              ))}
            <div hidden={view !== "Charting"}>
              {game &&
                (source === "sample" ||
                  !coachingReadOnlyReason(
                    game,
                    event?.games ?? [],
                    scheduleNow,
                  )) &&
                (!!game.state.lineupEvents?.length ||
                  !!game.state.events.length) && (
                  <ScoringWakeLock active={open && view === "Charting"} />
                )}
            </div>

            <div hidden={view !== "Charting"}>
              {game ? (
                <CoachLab
                  key={`${source}:${event.id}:${game.id}`}
                  unlocked
                  onResumeTracking={() => {
                    const current = drafts.current.get(
                      resumeId({ source, eventId: event.id, gameId: game.id }),
                    );
                    if (current)
                      drafts.current.set(
                        resumeId({
                          source,
                          eventId: event.id,
                          gameId: game.id,
                        }),
                        {
                          ...current,
                          draft: current.current ?? current.draft,
                          editing: null,
                        },
                      );
                    setResumeResetKey((value) => value + 1);
                  }}
                  resume={drafts.current.get(
                    resumeId({ source, eventId: event.id, gameId: game.id }),
                  )}
                  resumeResetKey={resumeResetKey}
                  onResume={(value) => retainDraft(value)}
                  onTrackingProgress={(value) =>
                    retainDraft(value, true, value.stateRevision)
                  }
                  context={{
                    source,
                    label: `${game.label} · vs ${game.opponent}`,
                    eventId: event.id,
                    gameId: game.id,
                    readOnlyReason:
                      source === "streamer"
                        ? coachingReadOnlyReason(game, event.games, scheduleNow)
                        : null,
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

            {statistics && !statsReady ? (
              <section className="event-card" role="status">
                {statsError || "Loading analysis�"}
              </section>
            ) : (
              statistics && (
                <>
                  <AnalysisPanels
                    key={view}
                    mode={
                      view === "Miss analysis"
                        ? "misses"
                        : view === "Game analysis"
                          ? "game"
                          : "performance"
                    }
                    shots={selected}
                    games={analysisGames}
                    players={analysisPlayers}
                    catalog={analysisData?.catalog ?? []}
                    seasonShots={filterAnalysisShots(
                      eventShots({
                        ...event,
                        games: seasonReady
                          ? (statsData?.event.games.filter(
                              (g) =>
                                competitionLevel === "all" ||
                                (g.competitionLevel ?? "unrecorded") ===
                                  competitionLevel,
                            ) ?? [])
                          : [],
                      }).filter(
                        (s) => player === "all" || s.playerId === player,
                      ),
                      seasonReady
                        ? (statsData?.event.games.filter(
                            (g) =>
                              competitionLevel === "all" ||
                              (g.competitionLevel ?? "unrecorded") ===
                                competitionLevel,
                          ) ?? [])
                        : [],
                      shotFilters,
                    )}
                    seasonReady={seasonReady}
                    byEvent={selectedEvent === "all"}
                  />
                  {view === "Game analysis" && (
                    <>
                      <p className="score-stat-caption">
                        Game outcomes below describe the whole team across the
                        selected games. Player and More filters apply to
                        shooting analysis above.
                      </p>
                      <Scoreboard
                        event={{ ...event, games: analysisGames }}
                        singleGame={analysisGame !== "all"}
                      />
                    </>
                  )}
                </>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
