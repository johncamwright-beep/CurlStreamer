"use client";
import ReportDocument from "./ReportDocument";
import { ReportEmail } from "./ReportEmail";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { downloadReportPDF } from "@/lib/curlcoach/report-pdf";
import type {
  ReportAudience,
  ReportPacket,
  ReportStatus,
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
  autoStart = false,
}: {
  eventId: string;
  autoStart?: boolean;
  renderLayout?: (navigation: ReactNode, content: ReactNode) => ReactNode;
}) {
  const [status, setStatus] = useState<ReportStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<ReportAudience | null>(null),
    [selected, setSelected] = useState<string>("coach");
  const [generatingSet, setGeneratingSet] = useState(false);
  const started = useRef(false);
  const [failures, setFailures] = useState<
    Partial<Record<ReportAudience, string>>
  >({});
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
  const processing = status?.entries.some(
    (e) => e.status === "processing" && !e.resumable,
  );
  useEffect(() => {
    // Local generation refreshes after each completed step. Poll only work
    // started elsewhere; each status read also loads the event's analytics.
    if (!processing || busy) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "visible")
        await load(c.signal).catch(() => undefined);
      if (!c.signal.aborted) timer = setTimeout(poll, 15000);
    }
    timer = setTimeout(poll, 15000);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [processing, busy, load]);
  async function generate(audience: ReportAudience, upgrade = false) {
    if (busy) return;
    setBusy(audience);
    setSelected(audience);
    setError("");
    setFailures((f) => ({ ...f, [audience]: undefined }));
    const c = new AbortController();
    active.current = c;
    try {
      for (;;) {
        const r = await fetch("/api/curlcoach/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, audience, upgrade }),
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
                      status:
                        data.packet?.complete === false
                          ? "processing"
                          : "ready",
                      resumable: data.packet?.complete === false,
                      stale: false,
                      packet: data.packet as ReportPacket,
                    },
                  ],
                }
              : s,
          );
          await load(c.signal);
          if (data.packet?.complete === false) continue;
          return true;
        }
        break;
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setFailures((f) => ({
          ...f,
          [audience]: e instanceof Error ? e.message : "Report unavailable.",
        }));
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
    (a) =>
      !status?.entries.some((e) => e.audience === a.id && e.status === "ready"),
  );
  const canGenerate =
    !!status?.configured &&
    status.eligible &&
    status.allowance.owned &&
    (status.allowance.reserved ||
      status.allowance.used < status.allowance.limit) &&
    missing.some(
      (a) =>
        !status.allowance.completed.includes(a.id) ||
        status.entries.some((e) => e.audience === a.id && e.version === 9),
    );
  const outdated = audiences.filter((a) =>
    status?.entries.some(
      (e) =>
        e.audience === a.id &&
        e.packet &&
        e.packet.policy !== "shot-tracker-event-v9",
    ),
  );
  const canUpgrade =
    !!status?.configured &&
    status.eligible &&
    status.allowance.owned &&
    outdated.length > 0;
  async function generateSet(upgrade = false) {
    if (generatingSet || busy || !(upgrade ? canUpgrade : canGenerate)) return;
    setGeneratingSet(true);
    try {
      for (const a of upgrade
        ? audiences.filter((a) => outdated.includes(a) || missing.includes(a))
        : missing) {
        await generate(
          a.id,
          upgrade || !!status?.allowance.completed.includes(a.id),
        );
      }
    } finally {
      setGeneratingSet(false);
    }
  }
  useEffect(() => {
    if (autoStart && status && canGenerate && !started.current) {
      started.current = true;
      void generateSet();
    }
  });
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
          {canUpgrade && (
            <button
              className="btn min-h-11"
              disabled={generatingSet || !!busy || !!processing}
              onClick={() => void generateSet(true)}
            >
              Update to trend analysis
            </button>
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
      {status && (
        <div
          aria-label="Report generation progress"
          aria-live="polite"
          className="rounded-lg border border-slate-500/40 p-4 space-y-2"
        >
          {audiences.map((a) => {
            const item = status.entries.find((e) => e.audience === a.id);
            const running =
              busy === a.id ||
              (item?.status === "processing" && !item.resumable);
            const state =
              item?.status === "ready"
                ? "Ready"
                : failures[a.id] || item?.status === "failed"
                  ? "Needs retry"
                  : running
                    ? "Generating"
                    : item?.resumable
                      ? "Paused - resume remaining reports"
                      : generatingSet
                        ? "Queued"
                        : "Not generated";
            return (
              <div key={a.id}>
                <p className="font-semibold">
                  {a.label}: {state}
                </p>
                {failures[a.id] && (
                  <p role="alert" className="text-sm">
                    {failures[a.id]}
                  </p>
                )}
                {a.id === "players" &&
                  status.players?.map((p) => {
                    const ready =
                      item?.packet?.reports.some((r) => r.key === p.key) ||
                      item?.readyKeys?.includes(p.key);
                    const firstMissing = status.players?.find(
                      (x) => !item?.readyKeys?.includes(x.key),
                    );
                    return (
                      <p className="text-sm" key={p.key}>
                        {p.name}:{" "}
                        {ready
                          ? "Ready"
                          : running && firstMissing?.key === p.key
                            ? "Generating"
                            : state === "Needs retry"
                              ? firstMissing?.key === p.key
                                ? "Failed - retry available"
                                : "Waiting for retry"
                              : "Queued"}
                      </p>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
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
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              <button
                className="btn min-h-11"
                onClick={() => void download()}
                disabled={downloading}
              >
                {downloading ? "Preparing PDF…" : "Download PDF"}
              </button>
            </div>
            {selectedAudience !== "coach" && entry?.status === "ready" && (
              <ReportEmail
                key={`${eventId}:${selectedAudience}:${current.key}`}
                eventId={eventId}
                audience={selectedAudience}
                reportKey={current.key}
              />
            )}
            <ReportDocument report={current} eventName={packet.eventName} />
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
