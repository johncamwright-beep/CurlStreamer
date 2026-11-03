"use client";
import { useState } from "react";
import { StudioOverlay } from "@/components/StudioOverlay";
import { announceGameCompletion } from "@/lib/dashboard-refresh";

export function ReopenGameControl({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<{
    requestId: string;
    expectedRevision: number;
  }>();
  async function reopen() {
    setBusy(true);
    setError("");
    try {
      let body = request;
      if (!body) {
        const snapshot = await fetch(`/api/games/${gameId}/result`, {
          cache: "no-store",
        });
        const value = await snapshot.json();
        if (!snapshot.ok || !Number.isSafeInteger(value.revision))
          throw Error(value.error || "Could not read the final result.");
        body = {
          requestId: crypto.randomUUID(),
          expectedRevision: value.revision,
        };
        setRequest(body);
      }
      const response = await fetch(`/api/games/${gameId}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 409) setRequest(undefined);
        throw Error(value.error || "Could not reopen scoring.");
      }
      if (value.status !== "active" || value.gameId !== gameId)
        throw Error("Could not confirm reopening.");
      announceGameCompletion(gameId);
      window.location.assign(`/score/${gameId}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reopen scoring.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="btn-secondary mt-5 min-h-11"
        onClick={() => setOpen(true)}
      >
        Reopen scoring
      </button>
      {open && (
        <StudioOverlay
          open
          title="Reopen scoring"
          onClose={() => setOpen(false)}
          dismissible={!busy}
        >
          <p>
            Continue playing from the saved score. You can edit the score and
            end the game again.
          </p>
          <p className="mt-2 text-sm text-slate-300">
            An ended YouTube broadcast stays ended.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
          <button
            className="btn mt-4 min-h-11"
            disabled={busy}
            onClick={reopen}
          >
            {busy ? "Reopening…" : "Reopen and continue"}
          </button>
        </StudioOverlay>
      )}
    </>
  );
}
