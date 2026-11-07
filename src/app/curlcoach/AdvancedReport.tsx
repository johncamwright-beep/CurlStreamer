import type { AdvancedReport as Summary } from "@/lib/curlcoach/advanced-report";

export default function AdvancedReport({ summary }: { summary?: Summary }) {
  if (!summary) return null;
  return (
    <section aria-label="Advanced analytics" className="space-y-3">
      <h4 className="text-lg font-bold">Advanced analytics</h4>
      <p className="text-sm text-slate-300">
        {summary.recorded} of {summary.included} included shots have validated
        Enhanced records.
        {summary.unavailable > 0 &&
          ` Data unavailable for ${summary.unavailable} shots.`}
        {summary.needsReview > 0 &&
          ` ${summary.needsReview} records need review.`}{" "}
        Each observation uses its own assessed denominator. Multiple result tags
        can overlap; missing observations are not successful shots.
      </p>
      {summary.groups.map((group) => (
        <details
          key={group.title}
          className="rounded-lg border border-slate-500/40 p-3"
        >
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">
            {group.title}
          </summary>
          <dl className="space-y-3">
            {group.metrics.map((metric) => (
              <div
                key={metric.id}
                className="flex flex-wrap justify-between gap-2 text-sm"
              >
                <dt>{metric.label}</dt>
                <dd className="tabular-nums">
                  {metric.value}
                  {metric.sample < 10
                    ? " · Small sample"
                    : metric.sample < 20
                      ? " · Tentative"
                      : ""}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </section>
  );
}
