"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  coachSenderName,
  reportEmailMessage,
} from "@/lib/curlcoach/report-email-message";
type Preview = {
  planToken: string;
  title: string;
  configured: boolean;
  coachName: string;
  subject: string;
  coachMessage: string;
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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<
    { name: string; email: string; status: string }[]
  >([]);
  const [resend, setResend] = useState(false);
  const [coachName, setCoachName] = useState("");
  const [subject, setSubject] = useState("");
  const [coachMessage, setCoachMessage] = useState("");
  const [cc, setCC] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!preview) return;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [preview]);
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
      setCoachName(data.coachName ?? "");
      setSubject(data.subject ?? "");
      setCoachMessage(data.coachMessage ?? "");
      setCC("");
      setPreview(data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Email unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview || busy) return;
    const draft = reportEmailMessage.safeParse({
      coachName,
      subject,
      coachMessage,
      cc: cc
        .split(/[,;\n]+/)
        .map((email) => email.trim())
        .filter(Boolean),
    });
    if (!draft.success) {
      setMessage(
        "Enter a coach name, subject and message, and up to 10 valid CC email addresses.",
      );
      return;
    }
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
          ...draft.data,
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
  const fieldClass =
    "min-h-11 rounded border border-slate-500 bg-slate-800 p-3";
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
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-cyan-700 bg-slate-900 p-5 text-white backdrop:bg-black/70"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setPreview(null);
          }}
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <h3 id={titleId} className="text-xl font-bold">
              Email {audience === "team" ? "team" : "player"} report
            </h3>
            <h4 className="font-bold">Recipients</h4>
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
            <label className="grid gap-1">
              Coach’s name
              <input
                required
                maxLength={100}
                value={coachName}
                disabled={busy}
                onChange={(e) => setCoachName(e.target.value)}
                className={fieldClass}
              />
            </label>
            <p className="text-sm text-slate-300">
              Sender:{" "}
              {coachName.trim()
                ? coachSenderName(coachName)
                : "Coach (enter your name)"}
            </p>
            <label className="grid gap-1">
              CC email addresses (optional)
              <textarea
                rows={2}
                value={cc}
                disabled={busy}
                maxLength={2560}
                onChange={(e) => setCC(e.target.value)}
                aria-describedby={`${titleId}-cc`}
                className={fieldClass}
              />
            </label>
            <p id={`${titleId}-cc`} className="text-sm text-slate-300">
              Separate addresses with commas. Up to 10 parents or coaches. Each
              gets one separate copy of this report; player addresses stay
              private.
            </p>
            <label className="grid gap-1">
              Subject
              <input
                required
                maxLength={200}
                value={subject}
                disabled={busy}
                onChange={(e) => setSubject(e.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-1">
              Coach’s message
              <textarea
                required
                rows={7}
                maxLength={10000}
                value={coachMessage}
                disabled={busy}
                onChange={(e) => setCoachMessage(e.target.value)}
                className={fieldClass}
              />
            </label>
            <p className="rounded-lg bg-slate-800 p-3">
              PDF attachment: {preview.title}
            </p>
            <p className="text-sm text-slate-300">
              Each recipient receives only this report in a separate email. No
              account is needed to read the PDF.
            </p>
            {!preview.configured && <p>Email sending is not configured.</p>}
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={resend}
                disabled={busy}
                onChange={(e) => setResend(e.target.checked)}
              />
              Send again even if this report was already sent. This may create a
              duplicate.
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                className="btn min-h-11"
                type="submit"
                disabled={
                  busy ||
                  !preview.configured ||
                  (!preview.recipients.length && !cc.trim())
                }
              >
                {busy ? "Sending…" : "Confirm and send"}
              </button>
              <button
                className="btn-secondary min-h-11"
                type="button"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                {results.length ? "Close" : "Cancel"}
              </button>
            </div>
            <p role="status">{message}</p>
            {!!results.length && (
              <ul role="status">
                {results.map((r) => (
                  <li key={r.email}>
                    {r.name} ({r.email}):{" "}
                    {labels[r.status] ?? "Not sent; refresh to review."}
                  </li>
                ))}
              </ul>
            )}
          </form>
        </dialog>
      )}
      {!preview && <p role="status">{message}</p>}
    </section>
  );
}
