"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ReportAudience,
  ReportPacket,
  ReportStatus,
  SavedReport,
} from "@/lib/curlcoach/reports";
const audiences = [
  {
    id: "coach",
    label: "Coach report",
    detail: "Private analysis for the coach, including individual follow-up.",
  },
  {
    id: "team",
    label: "Team report",
    detail:
      "Collective performance and shared practice. No individual player analysis.",
  },
  {
    id: "players",
    label: "Individual reports",
    detail:
      "A separate strengths and development report for each recorded player.",
  },
] as const;
export default function EventReports({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<ReportStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<ReportAudience | null>(null),
    [selected, setSelected] = useState<ReportAudience>("coach");
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await fetch(
        `/api/curlcoach/reports?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store", signal },
      );
      const result = await r
        .json()
        .catch(() => ({ error: "Reports are unavailable in this workspace." }));
      if (!r.ok) throw new Error(result.error ?? "Reports unavailable.");
      if (!signal?.aborted) setStatus(result);
    },
    [eventId],
  );
  useEffect(() => {
    const c = new AbortController();
    setStatus(null);
    setError("");
    void load(c.signal).catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => {
      c.abort();
      active.current?.abort();
    };
  }, [load]);
  const processing = status?.entries.some((e) => e.status === "processing");
  useEffect(() => {
    if (!processing || busy) return;
    const c = new AbortController();
    const timer = setInterval(
      () => void load(c.signal).catch(() => undefined),
      6000,
    );
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, [processing, busy, load]);
  async function generate(audience: ReportAudience) {
    if (busy) return;
    setBusy(audience);
    setSelected(audience);
    setError("");
    const c = new AbortController();
    active.current = c;
    try {
      const r = await fetch("/api/curlcoach/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, audience }),
        signal: c.signal,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Report generation failed.");
      if (!c.signal.aborted) {
        setStatus((s) =>
          s
            ? {
                ...s,
                entries: [
                  ...s.entries.filter((e) => e.audience !== audience),
                  {
                    audience,
                    status: "ready",
                    stale: false,
                    packet: data.packet as ReportPacket,
                  },
                ],
              }
            : s,
        );
        await load(c.signal);
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "Report unavailable.");
        void load(c.signal).catch(() => undefined);
      }
    } finally {
      if (!c.signal.aborted) setBusy(null);
    }
  }
  const entry = status?.entries.find((e) => e.audience === selected);
  return (
    <section
      className="event-card shot-tracker-reports space-y-4"
      aria-label="Shot Tracker event reports"
    >
      <div className="report-controls">
        <h2 className="text-xl font-bold">Shot Tracker event reports</h2>
        <p>One touch, using this event’s recorded games. No prompt required.</p>
        <p className="text-sm">
          AI-assisted drafts for coach review. Reports stay private to your
          coaching account; choosing a team or player audience does not send or
          publish anything.
        </p>
        {!status && !error && <p role="status">Loading reports…</p>}
        {status && !status.configured && (
          <p role="status">
            AI generation is not configured yet. Saved reports remain available.
          </p>
        )}
        {status?.reason && <p role="status">{status.reason}</p>}
        {status?.allowance && (
          <div className="text-sm space-y-1">
            <p>
              {status.allowance.used} of {status.allowance.limit} event report
              sets reserved this season (September–August).
            </p>
            <p>
              One coach report, one team report and one set of individual
              reports per event. Starting generation reserves an event slot;
              retries use the same slot. Saved reports can always be reopened
              while you have access.
            </p>
            {!status.allowance.owned && (
              <p>
                This event’s report set belongs to another coaching account.
                Reports remain private to their author.
              </p>
            )}
            {!status.allowance.reserved &&
              status.allowance.used >= status.allowance.limit && (
              <p>Your team has reached this season’s 20-event allowance.</p>
              )}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {audiences.map((a) => {
            const saved = status?.entries.find((e) => e.audience === a.id);
            return (
              <div className="rounded border border-slate-500 p-3" key={a.id}>
                <h3 className="font-bold">{a.label}</h3>
                <p className="mb-2 text-sm">{a.detail}</p>
                {saved?.stale && (
                  <p>
                    Event data changed since generation. This saved report
                    cannot be regenerated.
                  </p>
                )}
                {saved?.status === "failed" && (
                  <p>Previous generation did not finish. You can retry.</p>
                )}
                <button
                  className="btn min-h-11"
                  disabled={
                    !saved?.packet &&
                    (!!busy ||
                      !!processing ||
                      !status?.configured ||
                      !status.eligible ||
                      !status.allowance?.owned ||
                      status.allowance.completed.includes(a.id) ||
                      (!status.allowance.reserved &&
                        status.allowance.used >= status.allowance.limit))
                  }
                  onClick={() =>
                    saved?.packet ? setSelected(a.id) : void generate(a.id)
                  }
                >
                  {busy === a.id || saved?.status === "processing"
                    ? "Generating…"
                    : saved?.packet
                      ? `Open ${a.label.toLowerCase()}`
                      : `Generate ${a.label.toLowerCase()}`}
                </button>
                {saved?.packet && (
                  <button
                    className="ml-2 min-h-11 underline"
                    onClick={() => setSelected(a.id)}
                  >
                    View saved {a.label.toLowerCase()}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {busy && (
          <p role="status">
            Writing and checking the{" "}
            {audiences.find((a) => a.id === busy)?.label.toLowerCase()}…
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      {entry?.packet && (
        <div className="report-output">
          <div className="report-controls">
            <h3 className="text-xl font-bold">
              {audiences.find((a) => a.id === selected)?.label}
            </h3>
            <p>
              {entry.stale ? "Out of date · " : ""}Generated{" "}
              {new Date(entry.packet.generatedAt).toLocaleString()}
            </p>
            <button
              className="min-h-11 underline"
              onClick={() => window.print()}
            >
              Print / save PDF
            </button>
          </div>
          {entry.packet.reports.map((report) => (
            <ReportBody
              key={report.key}
              report={report}
              stale={entry.stale}
              eventName={entry.packet!.eventName}
            />
          ))}
        </div>
      )}
      <style>{`@media print {body * {visibility:hidden} .report-output,.report-output * {visibility:visible} .report-output {position:absolute;inset:0;color:black;background:white;padding:20px} .report-controls,.report-controls * {display:none!important} .report-document {break-before:page} .report-document:first-of-type {break-before:auto} .report-document h3,.report-document h4 {break-after:avoid} .report-document li {break-inside:avoid} }`}</style>
    </section>
  );
}
function ReportBody({
  report,
  stale,
  eventName,
}: {
  report: SavedReport;
  stale: boolean;
  eventName: string;
}) {
  const sections = [
    { name: "Summary", items: [report.narrative.summary] },
    { name: "Strengths", items: report.narrative.strengths },
    { name: "Improvement priorities", items: report.narrative.priorities },
    { name: "Practice plan", items: report.narrative.practice },
    { name: "Review questions", items: report.narrative.review },
  ];
  return (
    <article className="report-document my-5 space-y-4 rounded border border-slate-500 p-4">
      <h3 className="text-xl font-bold">Shot Tracker · {report.title}</h3>
      <p>{eventName}</p>
      <p>AI-assisted coaching draft{stale ? " · Out of date" : ""}</p>
      <details open>
        <summary className="min-h-11 font-bold">
          Coverage and limitations
        </summary>
        <ul className="list-disc pl-5">
          {report.limitations.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
      {sections.map((s) => (
        <section key={s.name}>
          <h4 className="font-bold">{s.name}</h4>
          <ul className="space-y-3">
            {s.items.map((f, i) => (
              <li key={i}>
                <p>{f.text}</p>
                <ul className="pl-4 text-sm">
                  {f.evidence.map((id) => {
                    const e = report.evidence.find((x) => x.id === id);
                    return e ? (
                      <li key={id}>
                        {e.label}: {e.value}{" "}
                        <span>({e.confidence} sample)</span>
                      </li>
                    ) : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <details>
        <summary className="min-h-11 font-bold">All recorded evidence</summary>
        <ul className="space-y-2">
          {report.evidence.map((e) => (
            <li key={e.id}>
              <strong>{e.label}:</strong> {e.value} ({e.confidence} sample)
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
