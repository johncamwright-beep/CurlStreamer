"use client";
import { ReportEmail } from "./ReportEmail";
import { MissReport } from "./MissReport";
import { reportLegend } from "@/lib/curlcoach/report-legend";
import { basisText, evidenceBasis } from "@/lib/curlcoach/report-counts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  reportPercentages,
  reportSections,
} from "@/lib/curlcoach/report-presentation";
import { downloadReportPDF } from "@/lib/curlcoach/report-pdf";
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
export default function EventReports({
  eventId,
  renderLayout,
}: {
  eventId: string;
  renderLayout?: (navigation: ReactNode, content: ReactNode) => ReactNode;
}) {
  const [status, setStatus] = useState<ReportStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<ReportAudience | null>(null),
    [selected, setSelected] = useState<string>("coach");
  const [generatingSet, setGeneratingSet] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
        return true;
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
  const selectedAudience = selected.split(":")[0] as ReportAudience;
  const entry = status?.entries.find((e) => e.audience === selectedAudience);
  const packet = entry?.packet;
  const current =
    packet?.reports.find((r) => r.key === selected.split(":")[1]) ??
    packet?.reports[0];
  const missing = audiences.filter(
    (a) => !status?.entries.some((e) => e.audience === a.id && e.packet),
  );
  const canGenerate =
    !!status?.configured &&
    status.eligible &&
    status.allowance.owned &&
    (status.allowance.reserved ||
      status.allowance.used < status.allowance.limit) &&
    missing.some((a) => !status.allowance.completed.includes(a.id));
  async function generateSet() {
    if (generatingSet || busy || !canGenerate) return;
    setGeneratingSet(true);
    try {
      for (const a of missing) {
        if (!(await generate(a.id))) break;
      }
    } finally {
      setGeneratingSet(false);
    }
  }
  async function download() {
    if (!current || !packet || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPDF(current, packet.eventName);
    } catch {
      setError("The PDF could not be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  }
  const navigation = (
    <nav aria-label="Event report list" className="flex flex-col gap-1">
      {audiences.flatMap((a) => {
        const saved = status?.entries.find((e) => e.audience === a.id)?.packet;
        const choices =
          a.id === "players" && saved?.reports.length
            ? saved.reports.map((r) => ({
                key: "players:" + r.key,
                label: r.title,
              }))
            : [{ key: a.id, label: a.label }];
        return (
          <div key={a.id} className="flex flex-col gap-1">
            {renderLayout && a.id === "players" && !!saved?.reports.length && (
              <button
                className="min-h-11 rounded px-3 py-3 text-left text-sm font-semibold hover:bg-slate-500/20"
                aria-expanded={selectedAudience === "players"}
                onClick={() => setSelected("players")}
              >
                Individual reports
              </button>
            )}
            {choices
              .filter(
                () =>
                  !renderLayout ||
                  a.id !== "players" ||
                  !saved?.reports.length ||
                  selectedAudience === "players",
              )
              .map((c) => (
                <button
                  key={c.key}
                  aria-current={
                    selected === c.key ||
                    (selected === "players" &&
                      c.key === "players:" + saved?.reports[0]?.key)
                      ? "page"
                      : undefined
                  }
                  className={
                    "min-h-11 rounded px-3 py-3 text-left text-sm " +
                    (selected === c.key ||
                    (selected === "players" &&
                      c.key === "players:" + saved?.reports[0]?.key)
                      ? "bg-cyan-400 font-bold text-slate-950"
                      : "hover:bg-slate-500/20")
                  }
                  onClick={() => setSelected(c.key)}
                >
                  {c.label}
                </button>
              ))}
          </div>
        );
      })}
    </nav>
  );
  const content = (
    <section
      className="event-card shot-tracker-reports space-y-5"
      aria-label="Shot Tracker event reports"
    >
      {" "}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Event reports</h2>
          <a
            className="inline-flex min-h-11 items-center text-sm underline"
            href="/shot-tracker/reports"
          >
            All events
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {status?.allowance && (
            <span className="text-sm">
              {status.allowance.used} / {status.allowance.limit} events this
              season
            </span>
          )}
          {!!missing.length && (
            <button
              className="btn min-h-11"
              disabled={!canGenerate || generatingSet || !!busy || !!processing}
              onClick={() => void generateSet()}
            >
              {generatingSet || busy || processing
                ? "Generating reports…"
                : missing.length === audiences.length
                  ? "Generate reports"
                  : "Generate remaining reports"}
            </button>
          )}
        </div>
      </header>
      {!status && !error && <p role="status">Loading reports…</p>}
      {status && !current && status.reason && (
        <p role="status">{status.reason}</p>
      )}
      {status && !status.allowance.owned && (
        <p>These reports are private to another coaching account.</p>
      )}
      {status &&
        !status.allowance.reserved &&
        status.allowance.used >= status.allowance.limit && (
          <p>Your team has used its twenty events this season.</p>
        )}
      {status && !status.configured && !!missing.length && (
        <p>Generation is unavailable. Saved reports can still be viewed.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="min-w-0">
        {current && packet ? (
          <>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-bold">{current.title}</h3>
                <p className="mt-1 text-sm">{packet.eventName}</p>
              </div>
              <button
                className="btn min-h-11"
                onClick={() => void download()}
                disabled={downloading}
              >
                {downloading ? "Preparing PDF…" : "Download PDF"}
              </button>
            </div>
            {selectedAudience !== "coach" && (
              <ReportEmail
                key={`${eventId}:${selectedAudience}:${current.key}`}
                eventId={eventId}
                audience={selectedAudience}
                reportKey={current.key}
              />
            )}
            <ReportBody report={current} />
          </>
        ) : (
          <div className="rounded border border-slate-500 p-6">
            <h3 className="mb-2 text-xl font-bold">
              {audiences.find((a) => a.id === selectedAudience)?.label}
            </h3>
            <p>
              {generatingSet || busy || processing
                ? "Your reports are being written. You can open saved reports while you wait."
                : "No report generated yet. Use Generate reports when your event data is ready."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
  return renderLayout ? (
    renderLayout(navigation, content)
  ) : (
    <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="border-b border-slate-500 pb-4 md:border-b-0 md:border-r md:pr-4">
        {navigation}
      </div>
      {content}
    </div>
  );
}
function ReportBody({ report }: { report: SavedReport }) {
  const percentages = reportPercentages(report);
  return (
    <article className="report-document space-y-7">
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-3"
        aria-label="Shooting percentages"
      >
        {percentages.map((m) => (
          <div className="rounded-lg bg-slate-500/10 p-4" key={m.id}>
            <p className="text-sm">{m.label}</p>
            <p
              className={
                "mt-1 font-bold " +
                (m.id === "overall" ? "text-3xl" : "text-2xl")
              }
            >
              {m.value}
            </p>
            <p className="mt-1 text-sm text-slate-300">{m.basis}</p>
          </div>
        ))}
      </div>
      {report.misses && <MissReport misses={report.misses} />}
      {reportSections(report).map((s) => (
        <section key={s.title}>
          <h4 className="mb-3 text-lg font-bold">{s.title}</h4>
          <div className="space-y-3">
            {s.findings.map((f, i) => (
              <div key={i} className="space-y-2">
                <p className="max-w-prose leading-relaxed">{f.text}</p>
                {!!f.statistics.length && (
                  <p className="text-sm text-cyan-300">
                    {f.statistics
                      .map((m) => `${m.label}: ${m.value}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {!!report.games?.length && (
        <section className="space-y-4" aria-label="Game by game">
          <h4 className="text-xl font-bold">Game by game</h4>
          <p className="text-sm">
            Open a game’s statistics to see every recorded measurement. — means
            not measured.
          </p>
          {report.games.map((game) => (
            <section
              key={game.key}
              className="rounded-lg border border-slate-500/40 p-4 space-y-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h5 className="font-bold">{game.title}</h5>
                <span className="font-bold">
                  {game.groups[0]?.metrics[0]?.value} shooting
                  {game.groups[0]?.metrics[0]?.basis && (
                    <small className="block font-normal">
                      {basisText(game.groups[0].metrics[0].basis)}
                    </small>
                  )}
                </span>
              </div>
              <p className="max-w-prose leading-relaxed">
                {report.narrative.games?.find((g) => g.key === game.key)?.text}
              </p>
              <details>
                <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                  Game statistics
                </summary>
                <div className="grid gap-4 lg:grid-cols-2">
                  {game.groups.slice(1).map((group) => (
                    <div key={group.title}>
                      <h6 className="mb-2 text-sm font-semibold">
                        {group.title}
                      </h6>
                      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                        {group.metrics.map((metric) => (
                          <div className="contents" key={metric.id}>
                            <dt>{metric.label}</dt>
                            <dd className="text-right tabular-nums">
                              <span>{metric.value}</span>
                              {metric.value !== "—" && (
                                <small className="block text-slate-300">
                                  {metric.basis
                                    ? basisText(metric.basis)
                                    : report.evidence.find(
                                          (e) => e.id === metric.id,
                                        )
                                      ? evidenceBasis(
                                          report.evidence.find(
                                            (e) => e.id === metric.id,
                                          )!,
                                        )
                                      : "Sample unavailable"}
                                </small>
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          ))}
        </section>
      )}
      <section aria-label="Report legend">
        <h4 className="mb-3 text-lg font-bold">Report legend</h4>
        <dl className="space-y-3">
          {reportLegend.map(([code, meaning]) => (
            <div key={code}>
              <dt className="font-semibold">{code}</dt>
              <dd className="text-sm text-slate-300">{meaning}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}
