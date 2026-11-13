"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
type Entry = {
  id: string;
  email: string;
  team: string;
  consent_version: string;
  created_at: string;
  notification_status: string;
  notification_sent_at: string | null;
  notification_attempted_at: string | null;
};
type Result = {
  entries: Entry[];
  total: number;
  recipient: string;
  emailConfigured: boolean;
};
const labels: Record<string, string> = {
  not_requested: "Existing signup — no notification sent",
  pending: "Pending",
  sending: "Sending / awaiting confirmation",
  accepted: "Accepted by email provider",
  failed: "Not sent — retry available",
  unknown: "Delivery uncertain — check Hello inbox",
};
export function WaitlistAdmin() {
  const [data, setData] = useState<Result | null>(null),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/waitlist?page=${page}`, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setData(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load waitlist.");
    } finally {
      setBusy(false);
    }
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);
  async function retry(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send notification.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black">
          Waitlist{data ? ` (${data.total})` : ""}
        </h1>
        <Link className="btn-secondary" href="/admin">
          Back to app admin
        </Link>
      </div>
      <p className="mb-4">
        New signup notifications go to{" "}
        {data?.recipient ?? "hello@curlstreamer.app"}.
      </p>
      {data && !data.emailConfigured && (
        <p role="alert" className="mb-4 text-amber-300">
          Email delivery is not configured. Signups are saved here;
          notifications remain available to retry after mail is configured.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 text-red-300">
          {error}
        </p>
      )}
      <button className="btn-secondary mb-4" disabled={busy} onClick={load}>
        {busy ? "Please wait…" : "Refresh waitlist"}
      </button>
      {!data && !error && <p role="status">Loading waitlist…</p>}
      {data?.total === 0 && <p>No waitlist signups yet.</p>}
      <div className="grid gap-3" aria-busy={busy}>
        {data?.entries.map((entry) => (
          <article key={entry.id} className="panel p-4">
            <a
              className="inline-flex min-h-11 items-center break-all font-bold text-cyan-300"
              href={`mailto:${entry.email}`}
            >
              {entry.email}
            </a>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-slate-400">Team</dt>
                <dd>{entry.team || "Not provided"}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Signed up</dt>
                <dd>{new Date(entry.created_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Consent</dt>
                <dd>Opted in · {entry.consent_version}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Email notification</dt>
                <dd>
                  {labels[entry.notification_status] ??
                    entry.notification_status}
                  {entry.notification_sent_at
                    ? ` · ${new Date(entry.notification_sent_at).toLocaleString()}`
                    : ""}
                </dd>
              </div>
            </dl>
            {entry.notification_status === "sending" && (
              <p className="mt-2 text-slate-300">
                If this remains unchanged, check the Hello inbox before
                requesting another notification.
              </p>
            )}
            {["pending", "failed"].includes(entry.notification_status) && (
              <button
                className="btn-secondary mt-3"
                disabled={busy || !data.emailConfigured}
                onClick={() => retry(entry.id)}
              >
                Send notification
              </button>
            )}
          </article>
        ))}
      </div>
      {data && data.total > 50 && (
        <nav
          aria-label="Waitlist pages"
          className="mt-5 flex items-center gap-3"
        >
          <button
            className="btn-secondary"
            disabled={busy || page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(data.total / 50)}
          </span>
          <button
            className="btn-secondary"
            disabled={busy || (page + 1) * 50 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </main>
  );
}
