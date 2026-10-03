"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearCurrentGameIfMatching } from "@/lib/current-game";
export function EventDeletionControl({
  eventId,
  name,
  gameCount,
}: {
  eventId: string;
  name: string;
  gameCount: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/events/" + eventId + "/deletion", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not delete event.");
      for (const id of body.gameIds ?? [])
        clearCurrentGameIfMatching(localStorage, id);
      router.push(
        body.cleanupPending ? "/dashboard/trash" : "/dashboard?tab=events",
      );
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-6">
      <button
        className="btn-secondary"
        onClick={() => dialog.current?.showModal()}
      >
        Delete event
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="delete-event-title"
        className="panel max-w-lg text-slate-100 backdrop:bg-black/70"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <h2 id="delete-event-title" className="text-xl font-bold">
          Delete {name}?
        </h2>
        <p className="my-4">
          This removes the event and all {gameCount} games from your schedule
          and team page. Stop any live broadcasts first. Retained history
          remains available to administrators.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-3">
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete event and games"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
