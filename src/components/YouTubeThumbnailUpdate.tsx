"use client";
import { useState } from "react";

export function YouTubeThumbnailUpdate({ gameId }: { gameId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function update() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/team-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "refreshYouTubeThumbnail", gameId }),
        signal: AbortSignal.timeout(25000),
      });
      const body = await response.json();
      setMessage(
        response.ok
          ? "Thumbnail updated. YouTube may take a little time to display it."
          : (body.error ?? "The thumbnail could not be updated. Try again."),
      );
    } catch {
      setMessage(
        "The update could not be confirmed. You can safely try again; the game and video link stay the same.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="btn-secondary min-h-11"
        disabled={busy}
        onClick={() => void update()}
      >
        {busy ? "Updating thumbnail…" : "Update YouTube thumbnail"}
      </button>
      {message && (
        <p className="max-w-sm text-sm" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
