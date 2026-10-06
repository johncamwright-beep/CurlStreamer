"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RosterEntry } from "@/lib/curlcoach/model";
import { resolvedLineup } from "@/lib/curlcoach/lineup";

export default function LineupDialog({
  starting = false,
  players,
  lineup,
  onSave,
  onCancel,
}: {
  starting?: boolean;
  players: readonly RosterEntry[];
  lineup?: readonly string[];
  onSave: (lineup: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [draft, setDraft] = useState(() => resolvedLineup(players, lineup));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl bg-slate-900 p-5 text-white backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={title} className="text-xl font-bold">
        Set game lineup
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        Choose who throws each of your team’s eight rocks, in order. Three
        players can share the rocks. Saved attempts keep their recorded player.
      </p>
      <form
        className="mt-4 grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await onSave(draft);
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Lineup could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, index) => (
            <label key={index}>
              Rock {index + 1}
              <select
                required
                value={draft[index] ?? ""}
                className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                onChange={(event) =>
                  setDraft((previous) =>
                    previous.map((value, current) =>
                      current === index ? event.target.value : value,
                    ),
                  )
                }
              >
                <option value="" disabled>
                  Select a player
                </option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300"
          aria-label="Rocks per player"
        >
          {players.map((player) => {
            const count = draft.filter((id) => id === player.id).length;
            return count ? (
              <span key={player.id}>
                {player.name}: {count} {count === 1 ? "rock" : "rocks"}
              </span>
            ) : null;
          })}
        </div>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
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
            disabled={busy || draft.length !== 8}
          >
            {busy
              ? "Saving…"
              : starting
                ? "Confirm lineup & start"
                : "Save lineup"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
