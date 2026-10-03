"use client";

import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { eventLevels } from "@/lib/team-hierarchy";
import {
  opponentPositions,
  opponentRosterSchema,
  opponentSeasonSchema,
  type OpponentSeason,
} from "@/lib/opponent-seasons";

const detailsSchema = z.object({
  opponent: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
  profile: opponentSeasonSchema.nullable(),
});

export type SavedOpponentDetails = {
  id: string;
  display_name: string;
  profile: OpponentSeason | null;
};

export function OpponentDetailsDialog({
  mode,
  opponent,
  initialName = "",
  canManageSeasonDetails = true,
  seasonId,
  seasonName,
  returnFocusTo,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  opponent?: { id: string; display_name: string };
  initialName?: string;
  canManageSeasonDetails?: boolean;
  seasonId: string;
  seasonName: string;
  returnFocusTo?: HTMLElement | null;
  onSaved: (value: SavedOpponentDetails) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState(initialName);
  const [expectedName, setExpectedName] = useState("");
  const [revision, setRevision] = useState(0);
  const [roster, setRoster] = useState(() => opponentRosterSchema.parse({}));
  const [level, setLevel] = useState<NonNullable<OpponentSeason["level"]> | "">(
    "",
  );
  const [loaded, setLoaded] = useState(mode === "create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const opponentId = opponent?.id;

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = returnFocusTo ?? document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      // The opener may be disabled while this dialog is mounted. Restore it
      // after the closing render has enabled the surrounding controls again.
      requestAnimationFrame(() => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
          previousFocus.focus();
      });
    };
  }, []);

  useEffect(() => {
    if (mode !== "edit") return;
    const controller = new AbortController();
    setLoaded(false);
    setError("");
    setConflict(false);
    void fetch(
      `/api/team-schedule?${new URLSearchParams({ opponentId: opponentId ?? "", seasonId })}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw Error(body.error ?? "Opponent details could not be loaded.");
        const data = detailsSchema.parse(body);
        if (controller.signal.aborted) return;
        if (
          data.opponent.id !== opponentId ||
          (data.profile &&
            (data.profile.opponent_id !== opponentId ||
              data.profile.season_id !== seasonId))
        )
          throw Error("Opponent details could not be loaded.");
        setName(data.opponent.displayName);
        setExpectedName(data.opponent.displayName);
        setRevision(data.profile?.revision ?? 0);
        setRoster(data.profile?.roster ?? opponentRosterSchema.parse({}));
        setLevel(data.profile?.level ?? "");
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Opponent details could not be loaded.",
          );
      });
    return () => controller.abort();
  }, [mode, opponentId, seasonId, reload]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!loaded || busy) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const response = await fetch("/api/team-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation:
            mode === "create"
              ? canManageSeasonDetails
                ? "createOpponentDetails"
                : "createOpponent"
              : "updateOpponentDetails",
          ...(mode === "edit" ? { opponentId } : {}),
          input: {
            displayName: name,
            ...(canManageSeasonDetails
              ? {
                  seasonId,
                  level: level || null,
                  roster,
                  expectedRevision: revision,
                  ...(mode === "edit"
                    ? { expectedDisplayName: expectedName }
                    : {}),
                }
              : {}),
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setConflict(response.status === 409 && mode === "edit");
        throw Error(body.error ?? "Opponent details could not be saved.");
      }
      if (mode === "create" && !canManageSeasonDetails) {
        const [saved] = z
          .array(
            z.object({
              opponent_id: z.uuid(),
              display_name: z.string().min(1),
            }),
          )
          .min(1)
          .parse(body);
        onSaved({
          id: saved.opponent_id,
          display_name: saved.display_name,
          profile: null,
        });
        return;
      }
      const data = detailsSchema.parse(body);
      if (!data.profile) throw Error("Opponent details could not be saved.");
      onSaved({
        id: data.opponent.id,
        display_name: data.opponent.displayName,
        profile: data.profile,
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Opponent details could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl bg-slate-900 p-5 text-white backdrop:bg-black/70 sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId} className="text-xl font-bold">
        {mode === "create" ? "New opponent" : "Edit opponent"}
      </h2>
      <p className="mt-2 text-sm text-slate-300">Season: {seasonName}</p>
      {!loaded && !error && <p role="status">Loading opponent details…</p>}
      <form className="mt-4 grid gap-4" onSubmit={save}>
        <fieldset disabled={!loaded || busy} className="grid gap-3">
          <label>
            Saved team name
            <input
              autoFocus={mode === "create"}
              className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {canManageSeasonDetails && (
            <>
              <label>
                Competition level
                <select
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                  value={level}
                  onChange={(event) =>
                    setLevel(event.target.value as typeof level)
                  }
                >
                  <option value="">Not recorded</option>
                  {eventLevels.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {opponentPositions.map((position) => (
                  <label key={position}>
                    {position[0].toUpperCase() + position.slice(1)}
                    <input
                      className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                      value={roster[position]}
                      maxLength={100}
                      placeholder="Name, if known"
                      onChange={(event) =>
                        setRoster({ ...roster, [position]: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>
        {canManageSeasonDetails && (
          <p className="text-sm text-slate-300">
            The team name is saved in your opponent directory. Players and
            competition level are saved for {seasonName}.
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        {!loaded && error && (
          <button
            type="button"
            className="btn-secondary min-h-11"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry loading details
          </button>
        )}
        {conflict && (
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload saved details (replace these edits)
          </button>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn min-h-11"
            disabled={!loaded || busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
