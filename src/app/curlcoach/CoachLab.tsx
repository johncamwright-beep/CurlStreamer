"use client";
import {
  withBroadcastReview,
  type BroadcastReview,
} from "@/lib/curlcoach/review";
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
import { nextTurn } from "@/lib/curlcoach/next-turn";
import { resolvedLineup, rockNumber } from "@/lib/curlcoach/lineup";
import LineupDialog from "./LineupDialog";
import ReviewSummary from "./ReviewSummary";

export function turnLabel(value: string) {
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
function inferredDraft(
  state: State | null,
  players: readonly NonNullable<State["roster"]>[number][],
): Shot {
  const shots = currentShots(state?.events ?? []);
  const latest = [...shots].sort(
    (a, b) => b.end - a.end || rockNumber(b) - rockNumber(a),
  )[0];
  const lineup = resolvedLineup(players, state?.lineup);
  return latest
    ? (nextTurn(latest, shots, players, lineup) ?? latest)
    : blankDraft(lineup[0] ?? "");
}
export default function CoachLab({
  unlocked,
  onResumeTracking,
  context,
  resume,
  onResume,
  resumeResetKey = 0,
  onTrackingProgress,
}: {
  unlocked: boolean;
  onResumeTracking?: () => void;
  resume?: { draft: Shot; editing: string | null; current?: Shot };
  onResume?: (value: {
    draft: Shot;
    editing: string | null;
    current?: Shot;
  }) => void;
  resumeResetKey?: number;
  onTrackingProgress?: (value: {
    draft: Shot;
    editing: string | null;
    current?: Shot;
    stateRevision: number;
  }) => void;
  context?: {
    source: "sample" | "streamer";
    label?: string;
    eventId: string;
    gameId: string;
    readOnlyReason?: string | null;
    roster?: State["roster"];
    initialState: State;
    broadcastReview?: BroadcastReview;
    onSaved: (state: State) => void;
  };
}) {
  const [open, setOpen] = useState(unlocked);
  const [state, setState] = useState<State | null>(
    context?.initialState ?? null,
  );
  const latestState = useRef(state);
  useEffect(() => {
    latestState.current = state;
  }, [state]);
  useEffect(() => {
    if (context) setState(context.initialState);
  }, [context?.initialState]);
  const initialPlayers =
    context?.initialState.roster ?? context?.roster ?? roster;
  const [draft, setDraft] = useState<Shot>(
    () =>
      resume?.draft ??
      inferredDraft(context?.initialState ?? null, initialPlayers),
  );
  const [editing, setEditing] = useState<string | null>(
    resume?.editing ?? null,
  );
  const currentDraft = useRef(resume?.current ?? draft);
  const deliberateDraftChange = useRef(false);
  const lastReset = useRef(resumeResetKey);
  useEffect(() => {
    if (lastReset.current === resumeResetKey) return;
    lastReset.current = resumeResetKey;
    const restored =
      resume?.current ??
      resume?.draft ??
      inferredDraft(state, state?.roster ?? context?.roster ?? [...roster]);
    currentDraft.current = restored;
    setDraft(restored);
    setEditing(null);
    entry.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [resumeResetKey, resume, state, context?.roster]);
  useEffect(() => {
    onResume?.({
      draft,
      editing,
      current: editing ? currentDraft.current : draft,
    });
  }, [draft, editing, onResume]);
  useEffect(() => {
    if (!deliberateDraftChange.current) return;
    deliberateDraftChange.current = false;
    if (!editing && state)
      onTrackingProgress?.({
        draft,
        editing: null,
        current: draft,
        stateRevision: state.revision ?? state.events.length,
      });
  }, [draft, editing, onTrackingProgress, state]);
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
  const [lineupOpen, setLineupOpen] = useState(false);
  const pendingLineup = useRef<{
    signature: string;
    requestId: string;
    expectedRevision: number;
  } | null>(null);
  const players = state?.roster ?? context?.roster ?? roster;
  const lineup = resolvedLineup(players, state?.lineup);
  const closed = state?.status === "closed" || !!context?.readOnlyReason;
  const rosterReady = players.length > 0;
  const started =
    !context || !!state?.lineupEvents?.length || !!state?.events.length;
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
    if (!state || closed || !started) return;
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
          resolvedLineup(data.roster ?? players, data.lineup),
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
        setDraft(
          nextTurn(
            shot,
            currentShots(data.events),
            data.roster ?? players,
            resolvedLineup(data.roster ?? players, data.lineup),
          ) ?? shot,
        );
      if (shot && !editing) {
        const current =
          nextTurn(
            shot,
            currentShots(data.events),
            data.roster ?? players,
            resolvedLineup(data.roster ?? players, data.lineup),
          ) ?? shot;
        currentDraft.current = current;
        onTrackingProgress?.({
          draft: current,
          editing: null,
          current,
          stateRevision: data.revision ?? data.events.length,
        });
      }
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
  async function saveLineup(nextLineup: string[]) {
    if (!context || !state) throw new Error("Open a game to set its lineup.");
    const signature = JSON.stringify(nextLineup);
    if (
      pendingLineup.current &&
      (state.revision ?? state.events.length) !==
        pendingLineup.current.expectedRevision &&
      !state.lineupEvents?.some(
        (event) => event.requestId === pendingLineup.current?.requestId,
      )
    )
      pendingLineup.current = null;
    if (pendingLineup.current?.signature !== signature)
      pendingLineup.current = {
        signature,
        requestId: crypto.randomUUID(),
        expectedRevision: state.revision ?? state.events.length,
      };
    const command = pendingLineup.current;
    const response = await fetch("/api/curlcoach/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: context.source,
        eventId: context.eventId,
        gameId: context.gameId,
        action: "set-lineup",
        lineup: nextLineup,
        requestId: command.requestId,
        expectedRevision: command.expectedRevision,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "Lineup could not be saved.");
    pendingLineup.current = null;
    // A durable retry returns its original committed snapshot. A refresh or
    // another tab may already have advanced this private session beyond it.
    const current = latestState.current ?? state;
    const confirmed: State =
      (current.revision ?? current.events.length) >
      (data.revision ?? data.events.length)
        ? current
        : data;
    const confirmedLineup = resolvedLineup(
      confirmed.roster ?? players,
      confirmed.lineup,
    );
    latestState.current = confirmed;
    setState(confirmed);
    context.onSaved(confirmed);
    currentDraft.current = {
      ...currentDraft.current,
      playerId: confirmedLineup[rockNumber(currentDraft.current) - 1],
    };
    if (!editing) {
      const updated = {
        ...draft,
        playerId: confirmedLineup[rockNumber(draft) - 1],
      };
      setDraft(updated);
      currentDraft.current = updated;
    }
    onTrackingProgress?.({
      draft: currentDraft.current,
      editing: null,
      current: currentDraft.current,
      stateRevision: confirmed.revision ?? confirmed.events.length,
    });
    setLineupOpen(false);
    setMessage(
      "Game lineup saved. Recorded attempts keep their original player.",
    );
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
            setDraft({
              ...draft,
              [field]: e.target.value || null,
              ...(field === "position"
                ? {
                    playerId:
                      lineup[
                        rockNumber({
                          position: e.target.value as Shot["position"],
                          stone: draft.stone,
                        }) - 1
                      ] ?? draft.playerId,
                  }
                : {}),
            })
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
      {context && (
        <button
          disabled={busy || closed || !rosterReady}
          onClick={() => setLineupOpen(true)}
        >
          Edit lineup
        </button>
      )}
      {onResumeTracking && (
        <button onClick={onResumeTracking} disabled={busy}>
          Resume tracking
        </button>
      )}
      <button
        aria-label="Undo latest change"
        title="Undo latest change"
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
        Undo
      </button>
      <button
        onClick={() => setHistory(!history)}
        aria-expanded={history}
        aria-label={`Revision history (${state?.events.length ?? 0})`}
        title="Revision history"
      >
        History ({state?.events.length ?? 0})
      </button>
      {context?.source === "streamer" && !closed && (
        <button
          className="coach-finish"
          aria-label="Finish private coaching session"
          title="Finish private coaching session"
          disabled={busy}
          onClick={() => void lifecycle("finish")}
        >
          Finish
        </button>
      )}
    </>
  );
  return (
    <section className={context ? "coach-lab coach-scoring" : "coach-lab"}>
      {lineupOpen && (
        <LineupDialog
          starting={!started}
          players={players}
          lineup={state?.lineup}
          onSave={saveLineup}
          onCancel={() => setLineupOpen(false)}
        />
      )}
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
      {context && !closed && (
        <header className="coach-panel">
          <h2>{context.label ?? "Selected game"}</h2>
          {!closed && started && (
            <div
              className="coach-session-actions"
              role="group"
              aria-label="Game actions"
            >
              {sessionActions}
            </div>
          )}
        </header>
      )}
      {!open ? (
        <form action={unlock} className="coach-panel">
          <h2>Unlock your local session</h2>
          <label>
            Local lab key
            <input name="key" type="password" required autoComplete="off" />
          </label>
          <button disabled={busy}>Unlock lab</button>
        </form>
      ) : closed ? (
        <section className="coach-panel" aria-label="Closed coaching session">
          <h2>Game closed</h2>
          <p>
            {context?.readOnlyReason ?? "This game is closed for charting."}
          </p>
          {context && (
            <button disabled={busy} onClick={() => void lifecycle("reopen")}>
              Reopen
            </button>
          )}
        </section>
      ) : !started ? (
        <section className="coach-panel">
          <h2>Ready to chart this game</h2>
          <p>Confirm the lineup before tracking the first rock.</p>
          {!rosterReady && (
            <p>
              Add your team roster before charting attempts.{" "}
              <a href="/account">Open Account team setup</a>
            </p>
          )}
          <button
            disabled={busy || !rosterReady}
            onClick={() => setLineupOpen(true)}
          >
            Start Charting
          </button>
        </section>
      ) : (
        <>
          <div className="coach-columns">
            <section ref={entry} className="coach-panel">
              <h2>{editing ? "Correct attempt" : "Chart an attempt"}</h2>
              <p>
                End {draft.end} · Rock {rockNumber(draft)} of 8
              </p>
              <form
                onChangeCapture={() => {
                  deliberateDraftChange.current = true;
                }}
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
                          setDraft({
                            ...draft,
                            stone: Number(e.target.value),
                            playerId:
                              lineup[
                                rockNumber({
                                  position: draft.position,
                                  stone: Number(e.target.value),
                                }) - 1
                              ] ?? draft.playerId,
                          })
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
                        Flag time saved automatically. Review links use the
                        game’s CurlStreamer broadcast when video timing is
                        available. Refresh the event after the broadcast starts.
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
                      disabled={!nextTurn(draft, shots, players, lineup)}
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
              <span>Graded / shots</span>
              <strong>
                {team.scored} / {team.attempts}
              </strong>
            </div>
            <div>
              <span>Ungraded</span>
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
          <ReviewSummary
            shots={shots.map((shot) =>
              withBroadcastReview(shot, context?.broadcastReview),
            )}
            players={players}
          />
          <section className="coach-panel" hidden={!!context && !history}>
            {!context && sessionActions}
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
