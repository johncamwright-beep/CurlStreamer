"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearCurrentGameIfMatching } from "@/lib/current-game";

export function GameDeletionControl({
  gameId,
  title,
  matchup,
  restore = false,
  cleanupStatus,
  cleanupAttempts,
  cleanupLastError,
}: {
  gameId: string;
  title: string;
  matchup: string;
  restore?: boolean;
  cleanupStatus?: "pending" | "failed" | "complete";
  cleanupAttempts?: number;
  cleanupLastError?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const router = useRouter();
  const label = restore ? "Restore Game" : "Delete Game";
  async function confirmChange() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/games/${gameId}/deletion`, {
        method: restore ? "POST" : "DELETE",
      });
      const body = (await response.json().catch(() => null)) as {
        deletionCommitted?: boolean;
        error?: string;
      } | null;
      const deletionCommitted = !restore && body?.deletionCommitted === true;
      if (deletionCommitted) clearCurrentGameIfMatching(localStorage, gameId);
      if (!response.ok && !deletionCommitted) {
        setError(
          body?.error ??
            `The game could not be ${restore ? "restored" : "deleted"}.`,
        );
        return;
      }
      dialog.current?.close();
      router.refresh();
    } catch {
      setError(
        `The game could not be ${restore ? "restored" : "deleted"}. Check your connection and try again.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function retryCleanup() {
    setBusy(true);
    setCleanupError("");
    try {
      const response = await fetch(`/api/games/${gameId}/deletion`, {
        method: "PATCH",
      });
      const body = (await response.json().catch(() => null)) as {
        deletionCommitted?: boolean;
        error?: string;
        warning?: string;
      } | null;
      if (!response.ok && body?.deletionCommitted !== true) {
        setCleanupError(
          body?.error ?? "Live video cleanup could not be retried.",
        );
        return;
      }
      router.refresh();
    } catch {
      setCleanupError(
        "Live video cleanup could not be retried. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg border border-red-700 px-3 py-2 text-red-200"
          onClick={() => dialog.current?.showModal()}
        >
          {label}
        </button>
        {restore && cleanupStatus && cleanupStatus !== "complete" && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void retryCleanup()}
          >
            Retry video cleanup
          </button>
        )}
      </div>
      {restore && cleanupStatus && cleanupStatus !== "complete" && (
        <p className="mt-2 text-sm text-amber-200">
          Live video cleanup is {cleanupStatus}
          {cleanupAttempts ? ` after ${cleanupAttempts} attempt(s)` : ""}.
          {cleanupLastError ? ` Last attempt: ${cleanupLastError}` : ""}
        </p>
      )}
      {cleanupError && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {cleanupError}
        </p>
      )}
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
