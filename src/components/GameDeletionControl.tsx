"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENT_GAME_KEY, readCurrentGame } from "@/lib/current-game";

export function GameDeletionControl({
  gameId,
  title,
  matchup,
  restore = false,
}: {
  gameId: string;
  title: string;
  matchup: string;
  restore?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const label = restore ? "Restore Game" : "Delete Game";
  async function confirmChange() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/games/${gameId}/deletion`, {
      method: restore ? "POST" : "DELETE",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(
        body?.error ??
          `The game could not be ${restore ? "restored" : "deleted"}.`,
      );
      setBusy(false);
      return;
    }
    if (!restore && readCurrentGame(localStorage)?.id === gameId) {
      localStorage.removeItem(CURRENT_GAME_KEY);
      dispatchEvent(new Event("curlcast-current-game"));
    }
    dialog.current?.close();
    router.refresh();
  }
  return (
    <>
      <button
        type="button"
        className="min-h-11 rounded-lg border border-red-700 px-3 py-2 text-red-200"
        onClick={() => dialog.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`game-change-${gameId}`}
        className="m-auto max-w-md rounded-xl bg-slate-900 p-6 text-white backdrop:bg-black/70"
      >
        <h2 id={`game-change-${gameId}`} className="text-xl font-bold">
          {label}: {title}
        </h2>
        {matchup && <p className="mt-2">{matchup}</p>}
        <p className="mt-3 text-slate-300">
          {restore
            ? "This game will return to the team dashboard with its configuration and scoring history intact."
            : "This game will disappear from the normal dashboard, but an owner or team administrator can restore it."}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              restore
                ? "btn"
                : "min-h-11 rounded-lg bg-red-700 px-4 py-3 font-bold"
            }
            disabled={busy}
            onClick={() => void confirmChange()}
          >
            Confirm {label}
          </button>
        </div>
      </dialog>
    </>
  );
}
