"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  currentShots,
  deficiencies,
  exclusions,
  executions,
  report,
  reviews,
  roster,
  shotTypes,
  turns,
  type Shot,
  type State,
} from "@/lib/curlcoach/model";
import "./coach.css";
import { createPortal } from "react-dom";
import { nextTurn } from "@/lib/curlcoach/next-turn";
import ReviewSummary from "./ReviewSummary";

function turnLabel(value: string) {
  const [turn, target, direction] = value.split(" ");
  return `${value} — ${turn === "CW" ? "Clockwise" : "Counterclockwise"}; broom ${target === "C" ? "inside" : "outside"} four-foot lines; ${direction === "IO" ? "away from" : "towards"} centre`;
}

const blank: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: null,
  turn: null,
  execution: null,
  grade: null,
  deficiency: null,
  review: null,
  excluded: null,
  note: "",
};
function blankDraft(playerId: string): Shot {
  return { ...blank, playerId };
}
export default function CoachLab({
  unlocked,
  actionsTarget,
  context,
  resume,
  onResume,
}: {
  unlocked: boolean;
  actionsTarget?: HTMLDivElement | null;
  resume?: { draft: Shot; editing: string | null; current?: Shot };
  onResume?: (value: {
    draft: Shot;
    editing: string | null;
    current?: Shot;
  }) => void;
  context?: {
    source: "sample" | "streamer";
    eventId: string;
    gameId: string;
    roster?: State["roster"];
    initialState: State;
    onSaved: (state: State) => void;
  };
}) {
  const [open, setOpen] = useState(unlocked);
  const [state, setState] = useState<State | null>(
    context?.initialState ?? null,
  );
  useEffect(() => {
    if (context) setState(context.initialState);
  }, [context?.initialState]);
  const initialPlayers =
    context?.initialState.roster ?? context?.roster ?? roster;
  const [draft, setDraft] = useState<Shot>(
    () =>
      resume?.draft ??
      (() => {
        const shots = currentShots(context?.initialState.events ?? []);
        const positions = ["Lead", "Second", "Third", "Fourth"];
        const latest = [...shots].sort(
          (a, b) =>
            b.end - a.end ||
            positions.indexOf(b.position) - positions.indexOf(a.position) ||
            b.stone - a.stone,
        )[0];
        return latest
          ? (nextTurn(latest, shots, initialPlayers) ?? latest)
          : blankDraft(initialPlayers[0]?.id ?? "");
      })(),
  );
  const [editing, setEditing] = useState<string | null>(
    resume?.editing ?? null,
  );
  const currentDraft = useRef(resume?.current ?? draft);
  useEffect(() => {
    onResume?.({
      draft,
      editing,
      current: editing ? currentDraft.current : draft,
    });
  }, [draft, editing, onResume]);
  const entry = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!editing) currentDraft.current = draft;
  }, [draft, editing]);
  function goToCurrent() {
    setEditing(null);
    setDraft(currentDraft.current);
    entry.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const players = state?.roster ?? context?.roster ?? roster;
  const closed = state?.status === "closed";
  const rosterReady = players.length > 0;
  useEffect(() => {
    if (rosterReady && !players.some((player) => player.id === draft.playerId))
      setDraft((current) => ({ ...current, playerId: players[0].id }));
  }, [draft.playerId, players, rosterReady]);
  const load = useCallback(async () => {
    try {
      const response = await fetch(
        context
          ? `/api/curlcoach/workspace?source=${context.source}&eventId=${encodeURIComponent(context.eventId)}`
          : "/api/curlcoach/game",
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(
        context
          ? data.event.games.find(
              (game: { id: string }) => game.id === context.gameId,
            )?.state
          : data,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Cannot reach the local lab.",
      );
    }
  }, [context]);
  useEffect(() => {
    if (open && !context) void load();
  }, [open, load, context]);
  async function unlock(form: FormData) {
    setBusy(true);
    try {
      const response = await fetch("/api/curlcoach/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: form.get("key") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setOpen(true);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to unlock.");
    } finally {
      setBusy(false);
    }
  }
  async function save(shot: Shot | null, id: string, advance = false) {
    if (!state) return;
    setBusy(true);
    try {
      const command = {
        requestId: crypto.randomUUID(),
        expectedRevision: state.revision ?? state.events.length,
        shotId: id,
        shot,
      };
      const response = await fetch(
        context ? "/api/curlcoach/workspace" : "/api/curlcoach/game",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            context
              ? {
                  source: context.source,
                  eventId: context.eventId,
                  gameId: context.gameId,
                  command,
                }
              : command,
          ),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(data);
      context?.onSaved(data);
      setEditing(null);
      setMessage(
        shot
          ? "Attempt saved. Report updated."
          : "Attempt removed by an audited revision.",
      );
      if (shot && advance) {
        const next = nextTurn(
          shot,
          currentShots(data.events),
          data.roster ?? players,
        );
        if (next) {
          const existing = currentShots(data.events).find(
            (attempt) =>
              attempt.end === next.end &&
              attempt.position === next.position &&
              attempt.stone === next.stone,
          );
          if (existing) {
            const { id: nextId, ...values } = existing;
            setDraft(values);
            setEditing(nextId);
            setMessage(
              `Saved. Next turn already recorded: end ${next.end}, ${next.position}, stone ${next.stone}. Review or correct it.`,
            );
          } else {
            setDraft(next);
            setMessage(
              `Saved. Next turn: end ${next.end}, ${next.position}, stone ${next.stone}.`,
            );
          }
        }
      } else if (editing) setDraft(currentDraft.current);
      else if (shot)
        setDraft({
          ...blank,
          end: shot.end,
          playerId: shot.playerId,
          position: shot.position,
          stone: shot.stone === 1 ? 2 : 1,
          flagged: false,
          ...(shot.videoReview
            ? { videoReview: { ...shot.videoReview, positionSeconds: null } }
            : {}),
        });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Save not confirmed. Reload before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle(action: "finish" | "reopen") {
    if (!context || !state) return;
    setBusy(true);
    try {
      const response = await fetch("/api/curlcoach/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: context.source,
          eventId: context.eventId,
          gameId: context.gameId,
          action,
          requestId: crypto.randomUUID(),
          expectedRevision: state.revision ?? state.events.length,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(data);
      context.onSaved(data);
      setMessage(
        action === "finish"
          ? "Private coaching session closed. Shared game scoring continues normally."
          : "Private coaching session reopened.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Session update was not confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function choose(
    field: "position" | "type" | "turn" | "execution" | "deficiency" | "review",
    label: string,
    options: readonly string[],
  ) {
    return (
      <label>
        {label}
        <select
          value={draft[field] ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, [field]: e.target.value || null })
          }
        >
          {field !== "position" && <option value="">Not recorded</option>}
          {options.map((value) => (
            <option key={value} value={value}>
              {field === "turn" ? turnLabel(value) : value}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const shots = state ? currentShots(state.events) : [];
  const team = report(shots);
  const lastRevision = new Map(
    state?.events.map((event, index) => [event.shotId, index]),
  );
  const recentShots = [...shots].sort(
    (a, b) => (lastRevision.get(b.id) ?? 0) - (lastRevision.get(a.id) ?? 0),
  );
  const sessionActions = (
    <>
      {" "}
      <button
        disabled={busy || closed || !state?.events.length}
        onClick={() => {
          if (!state?.events.length) return;
          const latest = state.events[state.events.length - 1];
          const previous = [...state.events.slice(0, -1)]
            .reverse()
            .find((event) => event.shotId === latest.shotId);
          void save(previous?.shot ?? null, latest.shotId);
        }}
      >
        Undo latest change
      </button>
      <button onClick={() => setHistory(!history)} aria-expanded={history}>
        Revision history ({state?.events.length ?? 0})
      </button>
      {context?.source === "streamer" && !closed && (
        <button
          className="coach-finish"
          disabled={busy}
          onClick={() => void lifecycle("finish")}
        >
          Finish private coaching session
        </button>
      )}
    </>
  );
  return (
    <section className={context ? "coach-lab coach-scoring" : "coach-lab"}>
      {!context && (
        <header>
          <p className="coach-eyebrow">SHOT TRACKER / LOCAL LAB</p>
          <h1>Every shot tells a story.</h1>
          <p>
            Synthetic practice game · Four-person curling · Provisional tracker
            profile
          </p>
          <p className="coach-notice">
            Mock coaching data only. This lab does not change the scoreboard,
            control broadcast audio, or connect to a shared database.
          </p>
        </header>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!open ? (
        <form action={unlock} className="coach-panel">
          <h2>Unlock your local session</h2>
          <label>
            Local lab key
            <input name="key" type="password" required autoComplete="off" />
          </label>
          <button disabled={busy}>Unlock lab</button>
        </form>
      ) : (
        <>
          {closed && (
            <section
              className="event-notice"
              aria-label="Closed coaching session"
            >
              <strong>Private coaching session closed.</strong> Review remains
              available. Reopen this private session to chart or correct
              attempts; this never completes the shared game or stops its
              stream.
              {context?.source === "streamer" && (
                <button
                  disabled={busy}
                  onClick={() => void lifecycle("reopen")}
                >
                  Reopen coaching session
                </button>
              )}
            </section>
          )}
          <div className="coach-columns">
            <section ref={entry} className="coach-panel">
              <h2>{editing ? "Correct attempt" : "Chart an attempt"}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const advance =
                    (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                      "value",
                    ) === "next";
                  void save(draft, editing ?? crypto.randomUUID(), advance);
                }}
              >
                <fieldset disabled={busy || !state || closed || !rosterReady}>
                  <div className="coach-fields">
                    <label>
                      Player
                      <select
                        value={draft.playerId}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            playerId: e.target.value as Shot["playerId"],
                          })
                        }
                      >
                        {players.map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {choose("position", "Throwing position", [
                      "Lead",
                      "Second",
                      "Third",
                      "Fourth",
                    ])}
                    <label>
                      End
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={draft.end}
                        required
                        onChange={(e) =>
                          setDraft({ ...draft, end: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Stone
                      <select
                        value={draft.stone}
                        onChange={(e) =>
                          setDraft({ ...draft, stone: Number(e.target.value) })
                        }
                      >
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </label>
                    {choose("type", "Shot type", shotTypes)}
                    {choose("turn", "Turn / target", turns)}
                    {choose("execution", "Execution", executions)}
                    <label>
                      Numeric grade
                      <select
                        value={draft.grade ?? ""}
                        disabled={!!draft.excluded}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            grade:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">Not graded</option>
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    {choose("deficiency", "Deficiency", deficiencies)}
                    {choose("review", "Review category", reviews)}
                    <label>
                      Excluded attempt
                      <select
                        value={draft.excluded ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            excluded: (e.target.value ||
                              null) as Shot["excluded"],
                            grade: e.target.value ? null : draft.grade,
                          })
                        }
                      >
                        <option value="">Include in scoring</option>
                        {exclusions.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <details>
                    <summary>Turn / target guide</summary>
                    <p>
                      CW / CCW: clockwise / counterclockwise. C / S: broom
                      inside / outside the four-foot lines. IO: travel away from
                      centre; other codes mean towards centre.
                    </p>
                  </details>
                  <label>
                    Flag shot for review
                    <select
                      value={(draft.flagged ?? !!draft.review) ? "yes" : "no"}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          flagged: e.target.value === "yes",
                          flaggedAt:
                            e.target.value === "yes"
                              ? new Date().toISOString()
                              : draft.flaggedAt,
                        })
                      }
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>
                  {(draft.flagged ?? !!draft.review) && (
                    <div className="coach-video-fields">
                      <div
                        className="coach-time-presets"
                        role="group"
                        aria-label="Go back presets"
                      >
                        {[30, 45, 60, 90, 120, 180, 240].map((seconds) => (
                          <button
                            key={seconds}
                            type="button"
                            aria-pressed={
                              (draft.videoReview?.lookBackSeconds ?? 30) ===
                              seconds
                            }
                            onClick={() =>
                              setDraft({
                                ...draft,
                                videoReview: {
                                  url: "",
                                  positionSeconds: null,
                                  ...draft.videoReview,
                                  lookBackSeconds: seconds,
                                },
                              })
                            }
                          >
                            {seconds < 120 ? `${seconds}s` : `${seconds / 60}m`}
                          </button>
                        ))}
                      </div>
                      <label>
                        Go back (seconds)
                        <input
                          type="number"
                          min="0"
                          max="3600"
                          step="1"
                          value={draft.videoReview?.lookBackSeconds ?? 30}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              videoReview: {
                                url: "",
                                positionSeconds: null,
                                ...draft.videoReview,
                                lookBackSeconds: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <p>
                        Flag time captured automatically. Video synchronization
                        is pending: this local preview has no timing connection
                        to the broadcast.
                      </p>
                    </div>
                  )}
                  <label>
                    Private coaching note
                    <textarea
                      rows={4}
                      maxLength={1000}
                      value={draft.note}
                      onChange={(e) =>
                        setDraft({ ...draft, note: e.target.value })
                      }
                    />
                  </label>
                  <div className="coach-entry-actions">
                    <button type="submit" value="save">
                      {busy
                        ? "Saving…"
                        : editing
                          ? "Save correction"
                          : "Save attempt"}
                    </button>
                    <button
                      type="submit"
                      value="next"
                      disabled={!nextTurn(draft, shots, players)}
                      title="Save this attempt and move to the next turn"
                    >
                      {busy ? "Saving next turn…" : "Next turn →"}
                    </button>
                    <button type="button" onClick={goToCurrent}>
                      Go to current shot
                    </button>
                    {editing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setDraft(currentDraft.current);
                        }}
                      >
                        Cancel correction
                      </button>
                    )}
                  </div>
                </fieldset>
              </form>
            </section>
            <section className="coach-panel">
              <h2>Player report</h2>
              {players.map((player) => {
                const r = report(shots.filter((s) => s.playerId === player.id));
                return (
                  <div className="coach-player" key={player.id}>
                    <strong>{player.name}</strong>
                    <span>
                      {r.percent === null
                        ? "No data"
                        : `${r.percent.toFixed(1)}%`}{" "}
                      · {r.scored} scored · {r.missing} missing · {r.excluded}{" "}
                      excluded
                    </span>
                  </div>
                );
              })}
              <p>
                Roster identity is saved with this private coaching session.
                Select the throwing position for substitutions; reports retain
                player identity.
              </p>
              <button disabled={busy} onClick={() => void load()}>
                Reload local data
              </button>
            </section>
          </div>
          <section className="coach-summary" aria-label="Team report">
            <div>
              <span>Team shooting</span>
              <strong>
                {team.percent === null
                  ? "No data"
                  : `${team.percent.toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>Scored / recorded</span>
              <strong>
                {team.scored} / {team.attempts}
              </strong>
            </div>
            <div>
              <span>Ungraded shots</span>
              <strong>{team.missing}</strong>
            </div>
            <div>
              <span>Excluded</span>
              <strong>{team.excluded}</strong>
            </div>
          </section>
          {!rosterReady && context?.source === "streamer" && (
            <section className="event-notice" aria-label="Roster required">
              Add your team roster before charting attempts.{" "}
              <a href="/account">Open Account team setup</a>
            </section>
          )}
          <section className="coach-panel">
            <h2>Recorded attempts</h2>
            {!shots.length && (
              <p>
                No attempts yet. Ungraded or unthrown stones are never treated
                as misses.
              </p>
            )}
            {recentShots.map((shot) => (
              <article className="coach-attempt" key={shot.id}>
                <div>
                  <strong>
                    End {shot.end} · {shot.position} · Stone {shot.stone}
                  </strong>
                  <p>
                    {players.find((p) => p.id === shot.playerId)?.name ??
                      shot.playerId}{" "}
                    · {shot.type ?? "Type not recorded"} ·{" "}
                    {shot.excluded ??
                      (shot.grade === null ? "Not graded" : `${shot.grade}/5`)}
                  </p>
                  {shot.note && <p>{shot.note}</p>}
                  {(shot.flagged ?? !!shot.review) && (
                    <p>⚑ Flagged for review</p>
                  )}
                </div>
                <button
                  disabled={busy || closed}
                  onClick={() => {
                    const { id, ...value } = shot;
                    setEditing(id);
                    setDraft(value);
                    setMessage(
                      "Editing selected attempt above. Previous values remain in history.",
                    );
                  }}
                >
                  Correct
                </button>
                <button
                  disabled={busy || closed}
                  onClick={() => void save(null, shot.id)}
                >
                  Remove attempt
                </button>
              </article>
            ))}
          </section>
          <ReviewSummary shots={shots} players={players} />
          <section className="coach-panel" hidden={!!actionsTarget && !history}>
            {actionsTarget
              ? createPortal(sessionActions, actionsTarget)
              : sessionActions}
            {history && (
              <ol>
                {[...(state?.events ?? [])].reverse().map((event) => (
                  <li key={event.requestId}>
                    <strong>Revision {event.revision}</strong> ·{" "}
                    {new Date(event.at).toLocaleString()}
                    {event.shot ? (
                      <p>
                        End {event.shot.end} · {event.shot.position} · Stone{" "}
                        {event.shot.stone} ·{" "}
                        {
                          players.find(
                            (player) => player.id === event.shot?.playerId,
                          )?.name
                        }
                        <br />
                        {event.shot.type ?? "Type not recorded"} · Grade:{" "}
                        {event.shot.grade === null
                          ? "Not graded"
                          : `${event.shot.grade}/5`}{" "}
                        · {event.shot.execution ?? "Execution not recorded"}
                        <br />
                        {event.shot.excluded
                          ? `Excluded: ${event.shot.excluded}`
                          : "Included attempt"}
                        {event.shot.note && (
                          <>
                            <br />
                            Note: {event.shot.note}
                          </>
                        )}
                        {(event.shot.flagged ?? !!event.shot.review) && (
                          <>
                            <br />
                            Flagged for review · look-back{" "}
                            {event.shot.videoReview?.lookBackSeconds ?? 30}s ·
                            video time{" "}
                            {event.shot.videoReview?.positionSeconds ??
                              "pending"}
                          </>
                        )}
                      </p>
                    ) : (
                      <p>Attempt removed. Earlier values are retained above.</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  );
}
