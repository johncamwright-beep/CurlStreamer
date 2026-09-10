"use client";
import { useState } from "react";
export function GameSummaryPost({
  gameId,
  initialSummary,
}: {
  gameId: string;
  initialSummary: string;
}) {
  const [open, setOpen] = useState(false),
    [summary, setSummary] = useState(initialSummary),
    [photo, setPhoto] = useState<File>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("gameId", gameId);
      form.append("summary", summary);
      form.append("published", "true");
      if (photo) form.append("photo", photo);
      const response = await fetch("/api/account/news", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setMessage(
        "Summary posted to team news. It appears publicly when your team page and news section are enabled.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save summary.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-5 text-left">
      <button className="btn-secondary" onClick={() => setOpen(!open)}>
        {open ? "Close summary" : "Write game summary"}
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <label>
            Game summary
            <textarea
              className="input mt-1 w-full"
              rows={4}
              maxLength={3000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <label>
            Attach a photo (optional)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-2 block min-h-11 w-full"
              onChange={(e) => setPhoto(e.target.files?.[0])}
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              className="btn"
              disabled={busy || !summary.trim()}
              onClick={save}
            >
              {busy ? "Posting…" : "Post summary"}
            </button>
            <button className="btn-secondary" disabled>
              Facebook not connected
            </button>
            <button className="btn-secondary" disabled>
              Instagram not connected
            </button>
          </div>
          <p className="text-sm text-slate-400">
            Connect social accounts in My Account once the Meta integration is
            available. Saving here does not post to Facebook or Instagram.
          </p>
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </section>
  );
}
