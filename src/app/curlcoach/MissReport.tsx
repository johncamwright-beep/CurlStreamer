import type { MissAnalysis } from "@/lib/curlcoach/report-misses";
import { countPercent } from "@/lib/curlcoach/report-counts";
const percent = (n: number | null) =>
  n === null ? "Not measured" : `${n.toFixed(1)}%`;
export function MissReport({ misses }: { misses: MissAnalysis }) {
  return (
    <section className="space-y-4" aria-label="Miss diagnosis">
      <h4 className="text-xl font-bold">Where the misses occurred</h4>
      <div className="rounded-xl border border-cyan-700 bg-cyan-900/10 p-4">
        <p className="text-sm">Partial, limited or missed outcomes</p>
        <p className="text-3xl font-bold">{percent(misses.rate)}</p>
        <p>
          {misses.misses} of {misses.classified} classified shots
        </p>
        <p className="mt-3 max-w-prose">{misses.focus}</p>
      </div>
      <p className="text-sm text-slate-300">{misses.definition}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {misses.categories
          .filter((c) => c.count)
          .map((c) => (
            <div key={c.tag} className="rounded-lg bg-slate-500/10 p-3">
              <p>{c.tag}</p>
              <p className="text-xl font-bold">{percent(c.percent)}</p>
              <p className="text-sm">
                {c.count} of {misses.misses} miss outcomes
              </p>
            </div>
          ))}
      </div>
      {!!misses.untaggedPercent && (
        <p className="text-sm">
          {countPercent(
            misses.untaggedPercent,
            misses.misses - misses.tagged,
            misses.misses,
          )}{" "}
          of miss outcomes have no usable category tag.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-bold">
            Miss patterns by shot type
          </caption>
          <thead>
            <tr>
              <th className="p-3">Shot type</th>
              <th className="p-3">Miss rate</th>
              <th className="p-3">
                Most frequent tag (% of this shot’s misses)
              </th>
            </tr>
          </thead>
          <tbody>
            {misses.byShot.map((r) => (
              <tr key={r.label} className="border-t border-slate-600">
                <td className="p-3">
                  {r.label}
                  {r.smallSample ? " *" : ""}
                </td>
                <td className="p-3">
                  {countPercent(r.rate, r.misses, r.attempts)}
                </td>
                <td className="p-3">
                  {r.topTag}
                  {r.topTag !== "Not tagged"
                    ? ` (${r.topCount === undefined ? percent(r.topPercent) : countPercent(r.topPercent, r.topCount, r.misses)})`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">
          Miss rates by turn
        </summary>
        <div className="flex flex-wrap gap-3">
          {misses.byTurn?.map((r) => (
            <div
              key={r.label}
              className="rounded-lg border border-slate-600 p-3"
            >
              <p>
                {r.label}
                {r.smallSample ? " *" : ""}
              </p>
              <p className="font-bold">
                {countPercent(r.rate, r.misses, r.attempts)}
              </p>
            </div>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap gap-3" aria-label="Miss rates by game">
        {misses.byGame.map((r) => (
          <div key={r.label} className="rounded-lg border border-slate-600 p-3">
            <p>
              {r.label}
              {r.smallSample ? " *" : ""}
            </p>
            <p className="font-bold">
              {countPercent(r.rate, r.misses, r.attempts)} miss rate
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-300">
        * Fewer than ten classified outcomes. Use as a review lead, not an
        established weakness. Tied categories are shown together.
      </p>
    </section>
  );
}
