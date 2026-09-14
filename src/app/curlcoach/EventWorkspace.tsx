"use client";
import { useCallback, useEffect, useState } from "react";
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
import CoachLab from "./CoachLab";
import ReviewSummary from "./ReviewSummary";
import "./coach.css";
const pages = [
  "Setup",
  "Scoring",
  "Data tables",
  "Scoreboard analysis",
  "Team",
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
                  <td key={i}>{value}</td>
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
export default function EventWorkspace({ unlocked }: { unlocked: boolean }) {
  const [open, setOpen] = useState(unlocked),
    [view, setView] = useState<Page>("Setup"),
    [source, setSource] = useState<"sample" | "streamer">("sample"),
    [eventId, setEventId] = useState("shorty-example"),
    [gameId, setGameId] = useState(""),
    [player, setPlayer] = useState("all"),
    [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get("source") === "streamer") setSource("streamer");
    if (query.get("event")) setEventId(query.get("event")!);
    if (query.get("game")) setGameId(query.get("game")!);
    const read = () =>
      setView(pages.find((p) => slug(p) === location.hash.slice(1)) ?? "Setup");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
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
            : (result.event.games[0]?.id ?? ""),
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
        <a className="event-brand" href="#setup">
          CURL<span>COACH</span>
        </a>
        <p>Event workspace</p>
        <nav aria-label="CurlCoach pages">
          {pages.map((page, i) => (
            <a
              href={`#${slug(page)}`}
              aria-current={view === page ? "page" : undefined}
              key={page}
            >
              <span>0{i + 1}</span>
              {page}
            </a>
          ))}
        </nav>
        <div className="event-sidebar-footer">
          Local development
          <br />
          Add-on disabled in production
        </div>
      </aside>
      <main className="event-main">
        <header className="event-header">
          <div>
            <p className="coach-eyebrow">{event?.name ?? "CURLCOACH"}</p>
            <h1>{view}</h1>
          </div>
          {open && (
            <div className="event-selectors">
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
                  <option value="streamer">Streamer · local connection</option>
                </select>
              </label>
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
              <button disabled={busy} onClick={() => void refresh()}>
                Refresh event
              </button>
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
              Use Local examples to explore the seven-game Shorty Jenkins
              workspace. A Streamer connection needs a disposable local service
              and a verified team administrator.
            </p>
          </section>
        ) : (
          <>
            <div className="event-scope">
              <strong>{event.name}</strong>
              <span>{event.games.length} games in event</span>
              <span>
                {event.source === "sample"
                  ? "SYNTHETIC EXAMPLE"
                  : "STREAMER · READ ONLY SCOREBOARD"}
              </span>
            </div>
            {(
              ["Scoring", "Game analysis", "Scoreboard analysis"] as Page[]
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
            {view === "Setup" && (
              <>
                <section className="event-card">
                  <h2>One event. Every game.</h2>
                  <p>
                    Scoring records one game at a time. Data tables and Team
                    combine every game in this event; Game analysis lets you
                    inspect each game separately.
                  </p>
                  <dl className="event-facts">
                    <div>
                      <dt>Team</dt>
                      <dd>{event.games[0]?.teamName ?? "No games"}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>
                        {event.source === "sample"
                          ? "Synthetic example · not live data"
                          : "Streamer event and game records"}
                      </dd>
                    </div>
                    <div>
                      <dt>Charted side</dt>
                      <dd>Home team in Streamer</dd>
                    </div>
                    <div>
                      <dt>Last refreshed</dt>
                      <dd>
                        {new Date(data!.refreshedAt).toLocaleTimeString()}
                      </dd>
                    </div>
                  </dl>
                </section>
                <Table
                  title="Event games"
                  columns={[
                    "Opponent",
                    "Ends",
                    "Status",
                    "Scored attempts",
                    "Scoreboard",
                  ]}
                  rows={event.games.map((g) => ({
                    label: g.label,
                    values: [
                      g.opponent,
                      g.scheduledEnds,
                      g.status,
                      report(gameShots(g)).scored,
                      g.scoreboardAvailable ? "Available" : "Unavailable",
                    ],
                  }))}
                />
                <section className="event-card">
                  <h3>Charting roster</h3>
                  <p>
                    {event.source === "streamer"
                      ? "Streamer game records provide team names, but no player roster. These are provisional position identities; confirm player mapping before using reports for real coaching."
                      : "Synthetic roster shared across the event. The alternate retains a separate identity when substituting."}
                  </p>
                  <div className="event-roster">
                    {roster.map((p) => (
                      <div key={p.id}>{p.name}</div>
                    ))}
                  </div>
                </section>
              </>
            )}
            {view === "Scoring" &&
              (game ? (
                <CoachLab
                  key={`${source}:${event.id}:${game.id}`}
                  unlocked
                  context={{
                    source,
                    eventId: event.id,
                    gameId: game.id,
                    initialState: game.state,
                    onSaved: saved,
                  }}
                />
              ) : (
                <p>No games in this event.</p>
              ))}
            {(view === "Data tables" || view === "Team") && (
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
                {roster.map((p) => (
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
            {view === "Data tables" && <DataTables shots={selected} />}
            {view === "Team" && (
              <>
                <h2>
                  {player === "all"
                    ? "Whole team"
                    : roster.find((p) => p.id === player)?.name}{" "}
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
                  <ReviewSummary shots={gameShots(game)} />
                  <Table
                    title="Player performance"
                    columns={["Graded", "Missing", "Shooting"]}
                    rows={roster.map((p) => {
                      const r = report(
                        gameShots(game).filter((s) => s.playerId === p.id),
                      );
                      return {
                        label: p.name,
                        values: [r.scored, r.missing, pct(r.percent)],
                      };
                    })}
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
            {view === "Scoreboard analysis" &&
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
