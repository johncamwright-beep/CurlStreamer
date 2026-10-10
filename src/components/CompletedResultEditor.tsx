"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompletedResultCorrection } from "@/lib/completed-result";
import {
  CompletedResultRequestError,
  prepareCompletedResultCorrection,
  requestCompletedResult,
  retainNewestCompletedResult,
  type CompletedEnd,
  type EditableCompletedResult,
} from "@/lib/completed-result-client";

export function CompletedResultEditor({
  gameId,
  initialSnapshot,
}: {
  gameId: string;
  initialSnapshot?: EditableCompletedResult;
}) {
  const router = useRouter();
  const id = useId();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [ends, setEnds] = useState<CompletedEnd[]>(
    initialSnapshot?.completion.result.ends ?? [],
  );
  const [noResult, setNoResult] = useState(
    !initialSnapshot?.completion.result.ends.length,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const pending = useRef<CompletedResultCorrection | null>(null);
  const flight = useRef(false);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot((current) =>
        retainNewestCompletedResult(current, initialSnapshot),
      );
      return;
    }
    let cancelled = false;
    setBusy(true);
    requestCompletedResult(gameId)
      .then((value) => {
        if (cancelled) return;
        setSnapshot(value);
        setEnds(value.completion.result.ends);
        setNoResult(!value.completion.result.ends.length);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The result could not be loaded.",
        );
        setForbidden(
          cause instanceof CompletedResultRequestError &&
            cause.kind === "authorization",
        );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, initialSnapshot]);

  async function reload() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await requestCompletedResult(gameId);
      if (!snapshot) {
        setEnds(value.completion.result.ends);
        setNoResult(!value.completion.result.ends.length);
      }
      setSnapshot(value);
      pending.current = null;
      setConflict(false);
      setForbidden(false);
      setNotice(
        snapshot
          ? "Latest saved result loaded. Your draft has been kept; compare it with the saved score before saving."
          : "Saved result loaded.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The result could not be loaded.",
      );
      setForbidden(
        cause instanceof CompletedResultRequestError &&
          cause.kind === "authorization",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  async function save() {
    if (!snapshot || flight.current || conflict || forbidden) return;
    setError("");
    setNotice("");
    if (!pending.current) {
      try {
        pending.current = prepareCompletedResultCorrection(
          snapshot.revision,
          noResult ? [] : ends,
          reason,
          crypto.randomUUID(),
        );
      } catch {
        setError(
          "Enter valid end scores and a reason of 1–500 characters before saving.",
        );
        return;
      }
    }
    flight.current = true;
    setBusy(true);
    try {
      const value = await requestCompletedResult(gameId, pending.current);
      const confirmed = retainNewestCompletedResult(
        latestSnapshot.current,
        value,
      );
      setSnapshot(confirmed);
      setEnds(confirmed.completion.result.ends);
      setNoResult(!confirmed.completion.result.ends.length);
      setReason("");
      pending.current = null;
      setUncertain(false);
      setNotice(
        "Correction saved. The final score below is confirmed by the database.",
      );
      try {
        router.refresh();
      } catch {
        // Navigation refresh cannot undo a database-confirmed correction.
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The save could not be confirmed. Retry the same correction.",
      );
      const kind =
        cause instanceof CompletedResultRequestError ? cause.kind : "uncertain";
      setUncertain(kind === "uncertain");
      setConflict(kind === "conflict");
      setForbidden(kind === "authorization");
      if (kind !== "uncertain") pending.current = null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  const locked = busy || uncertain || forbidden;
  const home = snapshot?.completion.homeName ?? "Home";
  const away = snapshot?.completion.awayName ?? "Away";
  const totals = ends.reduce(
    (sum, end) => {
      if (end.team) sum[end.team] += end.points;
      return sum;
    },
    { home: 0, away: 0 },
  );
  const scoreText = (
    result: EditableCompletedResult["completion"]["result"],
  ) =>
    result.totals
      ? `${home} ${result.totals.home} – ${result.totals.away} ${away}`
      : result.label;

  return (
    <section
      className="setup-card mb-6 space-y-5"
      aria-labelledby={`${id}-heading`}
    >
      <div>
        <h1 id={`${id}-heading`} className="text-2xl font-bold">
          Edit final result
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Correct the end scores and give a reason. The original scoring record
          and each correction remain in the history.
        </p>
      </div>
      {snapshot ? (
        <>
          <div
            className="rounded-lg bg-slate-900 p-4"
            aria-label="Saved final result"
          >
            <p className="text-sm text-slate-300">Saved final score</p>
            <p className="mt-1 text-lg font-bold">
              {scoreText(snapshot.completion.result)}
            </p>
            <p className="mt-1 text-sm">{snapshot.completion.result.label}</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="space-y-4"
          >
            <fieldset disabled={locked} className="space-y-4">
              <legend className="font-semibold">Corrected end scores</legend>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={noResult}
                  onChange={(event) => {
                    setNoResult(event.target.checked);
                    setNotice("");
                    if (!event.target.checked && !ends.length)
                      setEnds([{ end: 1, team: null, points: 0, blank: true }]);
                  }}
                />
                No result recorded
              </label>
              {!noResult && (
                <>
                  <ol className="space-y-3" aria-label="End scores">
                    {ends.map((end, index) => (
                      <li
                        key={end.end}
                        className="grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-end gap-3 rounded-lg border border-slate-700 p-3"
                      >
                        <span className="pb-3 text-sm font-semibold">
                          End {end.end}
                        </span>
                        <label className="min-w-0 text-sm">
                          Scoring team
                          <select
                            aria-label={`End ${end.end} scoring team`}
                            className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-2"
                            value={end.team ?? "blank"}
                            onChange={(event) => {
                              const team =
                                event.target.value === "blank"
                                  ? null
                                  : (event.target.value as "home" | "away");
                              setEnds((current) =>
                                current.map((item, slot) =>
                                  slot === index
                                    ? {
                                        ...item,
                                        team,
                                        blank: team === null,
                                        points:
                                          team === null
                                            ? 0
                                            : Math.max(1, item.points),
                                      }
                                    : item,
                                ),
                              );
                              setNotice("");
                            }}
                          >
                            <option value="blank">Blank end</option>
                            <option value="home">{home}</option>
                            <option value="away">{away}</option>
                          </select>
                        </label>
                        <label className="text-sm">
                          Points
                          <select
                            aria-label={`End ${end.end} points`}
                            className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-2"
                            value={end.points}
                            disabled={end.blank}
                            onChange={(event) => {
                              const points = Number(event.target.value);
                              setEnds((current) =>
                                current.map((item, slot) =>
                                  slot === index ? { ...item, points } : item,
                                ),
                              );
                              setNotice("");
                            }}
                          >
                            {end.blank ? (
                              <option value={0}>0</option>
                            ) : (
                              Array.from({ length: 8 }, (_, value) => (
                                <option key={value + 1} value={value + 1}>
                                  {value + 1}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="btn-secondary min-h-11"
                      disabled={ends.length >= 30}
                      onClick={() => {
                        setEnds((current) => [
                          ...current,
                          {
                            end: current.length + 1,
                            team: null,
                            points: 0,
                            blank: true,
                          },
                        ]);
                        setNotice("");
                      }}
                    >
                      Add end
                    </button>
                    <button
                      type="button"
                      className="btn-secondary min-h-11"
                      disabled={ends.length <= 1}
                      onClick={() => {
                        setEnds((current) => current.slice(0, -1));
                        setNotice("");
                      }}
                    >
                      Remove last end
                    </button>
                  </div>
                </>
              )}
              <p className="text-sm text-slate-300">
                Draft score:{" "}
                {noResult
                  ? "No result recorded"
                  : `${home} ${totals.home} – ${totals.away} ${away}`}
              </p>
              <label
                className="block text-sm font-semibold"
                htmlFor={`${id}-reason`}
              >
                Reason for correction
              </label>
              <textarea
                id={`${id}-reason`}
                className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-900 p-3"
                value={reason}
                maxLength={500}
                required
                onChange={(event) => {
                  setReason(event.target.value);
                  setNotice("");
                }}
                placeholder="Explain what was corrected"
              />
            </fieldset>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="btn min-h-11"
                disabled={
                  busy ||
                  conflict ||
                  forbidden ||
                  (!uncertain && !reason.trim())
                }
              >
                {busy
                  ? "Saving…"
                  : uncertain
                    ? "Retry same correction"
                    : "Save corrected result"}
              </button>
              {conflict && (
                <button
                  type="button"
                  className="btn-secondary min-h-11"
                  disabled={busy}
                  onClick={() => void reload()}
                >
                  Reload latest saved result
                </button>
              )}
            </div>
          </form>
        </>
      ) : (
        <div>
          <p role="status">
            {busy
              ? "Loading saved result…"
              : "Load the saved result to begin editing."}
          </p>
          {!busy && !forbidden && (
            <button
              type="button"
              className="btn-secondary mt-3 min-h-11"
              onClick={() => void reload()}
            >
              Load saved result
            </button>
          )}
        </div>
      )}
      {uncertain && (
        <p className="text-sm text-amber-200">
          Your correction is held unchanged while its save is unconfirmed. Retry
          to confirm it before making further edits.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-200">
          {notice}
        </p>
      )}
    </section>
  );
}
