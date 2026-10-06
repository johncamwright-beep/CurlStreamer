"use client";
import { useState } from "react";
type Preview = {
  planToken: string;
  title: string;
  configured: boolean;
  recipients: { playerId: string; name: string; email: string }[];
  skipped: string[];
};
export function ReportEmail({
  eventId,
  audience,
  reportKey,
}: {
  eventId: string;
  audience: "team" | "players";
  reportKey: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [results, setResults] = useState<
    { name: string; email: string; status: string }[]
  >([]);
  const [resend, setResend] = useState(false);
  async function review() {
    setBusy(true);
    setMessage("");
    setResults([]);
    setResend(false);
    try {
      const r = await fetch(
        `/api/curlcoach/report-email?${new URLSearchParams({ eventId, audience, reportKey })}`,
        { cache: "no-store" },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setPreview(data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Email unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/curlcoach/report-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          audience,
          reportKey,
          planToken: preview.planToken,
          resend,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setResults(data.results);
      setResend(false);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Delivery could not be confirmed. Check before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    accepted: "Accepted by the email provider",
    failed: "Not sent",
    unknown: "Delivery uncertain. Check with the recipient before resending.",
    sending: "A send is already in progress or needs checking",
    recent: "Recently attempted. Wait at least a minute before trying again.",
    limit: "Hourly email limit reached. Try later.",
  };
  return (
    <section className="mb-5 grid gap-3" aria-label="Email this report">
      <button
        className="btn-secondary min-h-11 justify-self-start"
        disabled={busy}
        onClick={() => void review()}
      >
        {audience === "team" ? "Email team report" : "Email player report"}
      </button>
      {preview && (
        <div className="grid gap-3 rounded-xl border border-cyan-700 p-4">
          <h4 className="font-bold">Review recipients: {preview.title}</h4>
          <p>
            Each recipient receives only this report as a PDF, in a separate
            email. No account is needed.
          </p>
          <ul>
            {preview.recipients.map((p) => (
              <li key={p.playerId}>
                {p.name} — {p.email}
              </li>
            ))}
          </ul>
          {!!preview.skipped.length && (
            <p>
              No email saved for: {preview.skipped.join(", ")}. They will not
              receive a report.
            </p>
          )}
          <a
            href="/account?section=team"
            className="min-h-11 py-3 text-cyan-300"
          >
            Manage private player emails
          </a>
          {!preview.configured && <p>Email sending is not configured.</p>}
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={resend}
              onChange={(e) => setResend(e.target.checked)}
            />
            Send again even if this report was already sent. This may create a
            duplicate.
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn min-h-11"
              disabled={
                busy || !preview.configured || !preview.recipients.length
              }
              onClick={() => void send()}
            >
              {busy ? "Sending…" : "Send PDF to listed recipients"}
            </button>
            <button
              className="btn-secondary min-h-11"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <p role="status">{message}</p>
      {!!results.length && (
        <ul role="status">
          {results.map((r) => (
            <li key={r.email}>
              {r.name}: {labels[r.status] ?? "Not sent; refresh to review."}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
