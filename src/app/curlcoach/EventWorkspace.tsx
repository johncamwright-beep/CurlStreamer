"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deficiencies,
  executions,
  report,
  roster,
  shotTypes,
  turns,
  type Shot,
  type State,
} from "@/lib/curlcoach/model";
import {
  eventShots,
  family,
  gameShots,
  grouped,
  matrix,
  workbookCategoryPercent,
  scoreTimeline,
  type CoachEvent,
  type CoachGame,
  type Workspace,
} from "@/lib/curlcoach/event";
import { preferredGame } from "@/lib/current-game";
import CoachLab from "./CoachLab";
import ReviewSummary from "./ReviewSummary";
import "./coach.css";
const pages = [
  "Scoring",
  "Shot breakdown",
  "End-by-end scores",
  "Team statistics",
  "Game analysis",
] as const;
type Page = (typeof pages)[number];
const slug = (page: string) => page.toLowerCase().replaceAll(" ", "-");
const pct = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
function Summary({ shots }: { shots: Shot[] }) {
  const r = report(shots);
  return (
    <div className="event-metrics">
      <div>
        <span>Shooting</span>
        <strong>{pct(r.percent)}</strong>
      </div>
      <div>
        <span>Scored / recorded</span>
        <strong>
          {r.scored} / {r.attempts}
        </strong>
      </div>
      <div>
        <span>Missing grades</span>
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
}: {
  title: string;
  columns: readonly string[];
  rows: { label: string; values: (string | number)[] }[];
}) {
  return (
    <section className="event-card">
      <h3>{title}</h3>
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
            {rows.map((row) => (
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
function DataTables({ shots }: { shots: Shot[] }) {
  return (
    <>
      <Summary shots={shots} />
      <p className="event-explainer">
        Shooting uses numerically graded attempts only. Category counts exclude
        picks, burnt rocks and throw-throughs. Missing categories are not
        counted as zero grades. Workbook category % uses the original category
        denominator, including typed attempts missing a grade; Shooting uses
        graded attempts only.
      </p>
      <Table
        title="Turn / deficiency"
        columns={deficiencies}
        rows={matrix(
          shots,
          turns,
          deficiencies,
          (s) => s.turn,
          (s) => s.deficiency,
        )}
      />
      <Table
        title="Shot type performance"
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
      <Table
        title="Result / draw type"
        columns={deficiencies}
        rows={matrix(
          shots,
          shotTypes.slice(0, 5),
          deficiencies,
          (s) => s.type,
          (s) => s.deficiency,
        )}
      />
      <Table
        title="Result / hit type"
        columns={deficiencies}
        rows={matrix(
          shots,
          shotTypes.slice(5),
          deficiencies,
          (s) => s.type,
          (s) => s.deficiency,
        )}
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
        <h3>Shooting across the event</h3>
        <p>
          Each bar uses graded attempts from that game. The event percentage
          uses all underlying points.
        </p>
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
          <Table
            key={f}
            title={`Turn analysis · ${f}`}
            columns={deficiencies}
            rows={matrix(
              shots.filter((s) => family(s) === f),
              turns,
              deficiencies,
              (s) => s.turn,
              (s) => s.deficiency,
            )}
          />
        ))}
      </div>
    </>
  );
}
function Scoreboard({ event, game }: { event: CoachEvent; game: CoachGame }) {
  const available = event.games.filter((g) => g.scoreboardAvailable);
  const timelines = available.flatMap((g) =>
    scoreTimeline(g).map((point) => ({ ...point, game: g.id })),
  );
  const maxEnd = Math.max(
    8,
    ...available.flatMap((g) => g.ends.map((e) => e.end)),
  );
  const columns = Array.from({ length: maxEnd + 1 }, (_, e) =>
    e === 0 ? "Start" : `After ${e}`,
  );
  const rows = Array.from({ length: 9 }, (_, i) => 4 - i).flatMap((diff) =>
    [true, false].map((hammer) => ({
      label: `${diff === 0 ? "Tied" : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)}${Math.abs(diff) === 4 ? "+" : ""}`} · ${hammer ? "With" : "Without"} hammer`,
      values: columns.map(
        (_, end) =>
          timelines.filter(
            (p) =>
              p.end === end &&
              Math.max(-4, Math.min(4, p.difference)) === diff &&
              p.hammer === hammer,
          ).length,
      ),
    })),
  );
  const timeline = scoreTimeline(game);
  return (
    <>
      <div className="event-notice">
        {event.source === "sample"
          ? "Example scoreboard data. No live Streamer connection."
          : "Read-only Streamer scoreboard. Shot grades never change end points."}
      </div>
      <div className="event-metrics">
        <div>
          <span>Games with scoreboard</span>
          <strong>
            {available.length} / {event.games.length}
          </strong>
        </div>
        <div>
          <span>Completed ends</span>
          <strong>{available.reduce((n, g) => n + g.ends.length, 0)}</strong>
        </div>
        <div>
          <span>Ends in advantage</span>
          <strong>Pending rule</strong>
        </div>
        <div>
          <span>Workbook target</span>
          <strong>70%</strong>
        </div>
      </div>
      <p>
        The workbook advantage totals are manual inputs. Its 70% target is shown
        for reference; a score/hammer advantage rule must be confirmed before
        calculating that rate. Final game positions are included below as
        observations, not automatically counted as advantage opportunities.
      </p>
      <Table
        title="Event score difference / hammer"
        columns={columns}
        rows={rows}
      />
      <p>
        Counts include all {available.length} available games. Unknown hammer is
        omitted from the matrix. Four or more points are grouped as 4+; extra
        ends are retained.
      </p>
      <section className="event-card">
        <h3>
          {game.label} · {game.teamName} vs {game.opponent}
        </h3>
        {!game.scoreboardAvailable ? (
          <p>Streamer end-by-end scoring is unavailable for this game.</p>
        ) : (
          <Table
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
        )}
      </section>
      {game.scoreboardAvailable && (
        <Table
          title="Game score / hammer timeline"
          columns={[
            "Our score",
            "Their score",
            "Difference",
            "Hammer after end",
          ]}
          rows={timeline.map((p) => ({
            label: p.end ? `After end ${p.end}` : "Start",
            values: [
              p.us,
              p.them,
              p.difference,
              p.hammer === null
                ? "Unknown"
                : p.hammer
                  ? "With us"
                  : "With opponent",
            ],
          }))}
        />
      )}
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
    [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [initialEventId, mode]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(
          `/api/curlcoach/workspace?source=${source}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ""}`,
          { cache: "no-store", signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setData(result);
        setGameId((current) =>
          result.event.games.some((g: CoachGame) => g.id === current)
            ? current
            : (preferredGame<CoachGame>(result.event.games)?.id ?? ""),
        );
      } catch (e) {
        if (!signal?.aborted) {
          setData(null);
          setError(e instanceof Error ? e.message : "Event unavailable");
        }
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [source, eventId],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [open, refresh]);
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
    all = event ? eventShots(event) : [],
    selected = all.filter((s) => player === "all" || s.playerId === player);
  function remember(source: string, event: string, game = "") {
    history.replaceState(
      null,
      "",
      `${location.pathname}?${new URLSearchParams({ source, event, game })}${location.hash}`,
    );
  }
  function saved(state: State) {
    setData((current) =>
      current
        ? {
            ...current,
            event: {
              ...current.event,
              games: current.event.games.map((g) =>
                g.id === state.gameId ? { ...g, state } : g,
              ),
            },
          }
        : current,
    );
  }
  return (
    <div className="coach-workspace">
      <aside className="event-sidebar">
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
          <div
            ref={setActionsTarget}
            hidden={view !== "Scoring"}
            className="coach-menu-actions"
          />
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
            <div className="event-selectors">
              {mode === "lab" && (
                <label>
                  Data source
                  <select
                    value={source}
                    onChange={(e) => {
                      setData(null);
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
              <label>
                Event
                <select
                  value={event?.id ?? eventId}
                  disabled={!data}
                  onChange={(e) => {
                    setData(null);
                    setEventId(e.target.value);
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
            </div>
          )}
        </header>
        <p role="status" aria-live="polite">
          {busy ? "Loading event…" : error}
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
            {(
              ["Scoring", "Game analysis", "End-by-end scores"] as Page[]
            ).includes(view) && (
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
                    onSaved: saved,
                  }}
                />
              ) : (
                <p>No games in this event.</p>
              )}
            </div>
            {(view === "Shot breakdown" || view === "Team statistics") && (
              <div
                className="event-player-tabs"
                role="group"
                aria-label="Player analysis"
              >
                <button
                  aria-pressed={player === "all"}
                  onClick={() => setPlayer("all")}
                >
                  Whole team
                </button>
                {(game?.roster ?? game?.state.roster ?? roster).map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={player === p.id}
                    onClick={() => setPlayer(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {view === "Shot breakdown" && <DataTables shots={selected} />}
            {view === "Team statistics" && (
              <>
                <h2>
                  {player === "all"
                    ? "Whole team"
                    : (
                        event.games.find((g) =>
                          (g.roster ?? g.state.roster)?.some(
                            (p) => p.id === player,
                          ),
                        )?.roster ??
                        event.games.find((g) =>
                          g.state.roster?.some((p) => p.id === player),
                        )?.state.roster ??
                        roster
                      ).find((p) => p.id === player)?.name}{" "}
                  · all {event.games.length} games
                </h2>
                <PlayerAnalysis
                  shots={selected}
                  games={event.games}
                  player={player}
                />
              </>
            )}
            {view === "Game analysis" &&
              (game ? (
                <>
                  <h2>
                    {game.label} · vs {game.opponent}
                  </h2>
                  <Summary shots={gameShots(game)} />
                  <ReviewSummary
                    shots={gameShots(game)}
                    players={game.roster ?? game.state.roster ?? roster}
                  />
                  <Table
                    title="Player performance"
                    columns={["Graded", "Missing", "Shooting"]}
                    rows={(game.roster ?? game.state.roster ?? roster).map(
                      (p) => {
                        const r = report(
                          gameShots(game).filter((s) => s.playerId === p.id),
                        );
                        return {
                          label: p.name,
                          values: [r.scored, r.missing, pct(r.percent)],
                        };
                      },
                    )}
                  />
                  <Table
                    title="End performance"
                    columns={["Recorded", "Graded", "Shooting"]}
                    rows={grouped(
                      gameShots(game),
                      Array.from(
                        {
                          length: Math.max(
                            game.scheduledEnds,
                            ...gameShots(game).map((s) => s.end),
                          ),
                        },
                        (_, i) => String(i + 1),
                      ),
                      (s) => String(s.end),
                    ).map((r) => ({
                      label: `End ${r.label}`,
                      values: [r.attempts, r.scored, pct(r.percent)],
                    }))}
                  />
                  <DataTables shots={gameShots(game)} />
                </>
              ) : (
                <p>No games in this event.</p>
              ))}
            {view === "End-by-end scores" &&
              (game ? (
                <Scoreboard event={event} game={game} />
              ) : (
                <p>No games in this event.</p>
              ))}
          </>
        )}
      </main>
    </div>
  );
}
