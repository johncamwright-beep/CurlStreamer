"use client";
import { useCallback, useEffect, useState } from "react";
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
import ReviewSummary from "./ReviewSummary";

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
export default function CoachLab({
  unlocked,
  context,
}: {
  unlocked: boolean;
  context?: {
    source: "sample" | "streamer";
    eventId: string;
    gameId: string;
    initialState: State;
    onSaved: (state: State) => void;
  };
}) {
  const [open, setOpen] = useState(unlocked);
  const [state, setState] = useState<State | null>(
    context?.initialState ?? null,
  );
  const [draft, setDraft] = useState<Shot>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
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
    if (open) void load();
  }, [open, load]);
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
        expectedRevision: state.events.length,
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
        const next = nextTurn(shot, currentShots(data.events));
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
      } else if (shot)
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
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
    );
  }
  const shots = state ? currentShots(state.events) : [];
  const team = report(shots);
  return (
    <section className={context ? "coach-lab coach-scoring" : "coach-lab"}>
      {!context && (
        <header>
          <p className="coach-eyebrow">CURLCOACH / LOCAL LAB</p>
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
              <span>Missing grades</span>
              <strong>{team.missing}</strong>
            </div>
            <div>
              <span>Excluded</span>
              <strong>{team.excluded}</strong>
            </div>
          </section>
          <p>
            Percentage = numeric points ÷ (5 × scored attempts). Zero counts;
            missing grades and exclusions do not. Execution categories are
            independent of grades.
          </p>
          <div className="coach-columns">
            <section className="coach-panel">
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
                <fieldset disabled={busy || !state}>
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
                        {roster.map((p) => (
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
                  <label className="coach-review-toggle">
                    <input
                      type="checkbox"
                      checked={draft.flagged ?? !!draft.review}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          flagged: e.target.checked,
                          flaggedAt: e.target.checked
                            ? new Date().toISOString()
                            : draft.flaggedAt,
                        })
                      }
                    />
                    Flag shot for review
                  </label>
                  {(draft.flagged ?? !!draft.review) && (
                    <div className="coach-video-fields">
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
                      disabled={!nextTurn(draft, shots)}
                      title="Save this attempt and move to the next turn"
                    >
                      Next turn →
                    </button>
                    <span>Saves this attempt, then advances.</span>
                    {editing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setDraft(blank);
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
              {roster.map((player) => {
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
                Roster snapshot includes one alternate. Select their throwing
                position for substitutions; reports retain individual player
                identity.
              </p>
              <button disabled={busy} onClick={() => void load()}>
                Reload local data
              </button>
            </section>
          </div>
          <section className="coach-panel">
            <h2>Recorded attempts</h2>
            {!shots.length && (
              <p>
                No attempts yet. Ungraded or unthrown stones are never treated
                as misses.
              </p>
            )}
            {shots.map((shot) => (
              <article className="coach-attempt" key={shot.id}>
                <div>
                  <strong>
                    End {shot.end} · {shot.position} · Stone {shot.stone}
                  </strong>
                  <p>
                    {roster.find((p) => p.id === shot.playerId)?.name} ·{" "}
                    {shot.type ?? "Type not recorded"} ·{" "}
                    {shot.excluded ??
                      (shot.grade === null ? "Not graded" : `${shot.grade}/5`)}
                  </p>
                  {shot.note && <p>{shot.note}</p>}
                  {(shot.flagged ?? !!shot.review) && (
                    <p>⚑ Flagged for review</p>
                  )}
                </div>
                <button
                  disabled={busy}
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
                  disabled={busy}
                  onClick={() => void save(null, shot.id)}
                >
                  Remove attempt
                </button>
              </article>
            ))}
          </section>
          <ReviewSummary shots={shots} />
          <section className="coach-panel">
            <button
              disabled={busy || !state?.events.length}
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
            <button
              onClick={() => setHistory(!history)}
              aria-expanded={history}
            >
              Revision history ({state?.events.length ?? 0})
            </button>
            {history && (
              <ol>
                {state?.events.map((event) => (
                  <li key={event.requestId}>
                    <strong>Revision {event.revision}</strong> ·{" "}
                    {new Date(event.at).toLocaleString()}
                    {event.shot ? (
                      <p>
                        End {event.shot.end} · {event.shot.position} · Stone{" "}
                        {event.shot.stone} ·{" "}
                        {
                          roster.find(
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
