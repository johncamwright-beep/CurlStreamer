"use client";
import { useRef, useState } from "react";
export function GameSummaryPost({
  gameId,
  initialSummary,
}: {
  gameId: string;
  initialSummary: string;
}) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState(false),
    [summary, setSummary] = useState(initialSummary),
    [photo, setPhoto] = useState<File>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const postId = useRef<string | null>(null);
  const saving = useRef(false);
  async function save() {
    if (saving.current || saved) return;
    saving.current = true;
    setBusy(true);
    try {
      const form = new FormData();
      postId.current ??= crypto.randomUUID();
      form.append("id", postId.current);
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
      setSaved(true);
      setMessage(
        "Summary posted to team news. It appears publicly when your team page and news section are enabled.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save summary.",
      );
    } finally {
      saving.current = false;
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
              disabled={busy || saved || !summary.trim()}
              onClick={save}
            >
              {saved ? "Summary posted" : busy ? "Posting…" : "Post summary"}
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
          {saved && (
            <a className="min-h-11 text-cyan-300 underline" href="/account">
              Edit this summary in My Account → Team news
            </a>
          )}
        </div>
      )}
    </section>
  );
}
