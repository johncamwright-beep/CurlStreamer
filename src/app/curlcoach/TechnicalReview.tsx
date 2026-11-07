import type { TechnicalSummary } from "@/lib/curlcoach/technical";

const rate = (value: number | null, count: number, total: number) =>
  value === null
    ? "Not measured"
    : `${value.toFixed(1)}% · ${count} / ${total}`;

export default function TechnicalReview({
  groups,
  compact = false,
}: {
  groups: TechnicalSummary;
  compact?: boolean;
}) {
  return (
    <section aria-label="Technical observations" className="min-w-0 space-y-4">
      <p className="text-sm text-slate-300">
        Shares use shots with that field recorded. Not recorded is not a
        successful delivery. Excluded attempts are omitted. Miss rate uses
        Partial, Limited and Miss out of classified execution outcomes. These
        are coaching observations, not proof of what caused a miss.
      </p>
      {groups
        .filter((g) => !compact || g.recorded > 0)
        .map((group) => (
          <section
            key={group.field}
            className="min-w-0 rounded-xl border border-slate-600 bg-slate-800/30 p-4"
          >
            <h3 className="text-lg font-bold">{group.title}</h3>
            {!compact && (
              <p className="my-2 text-sm text-slate-300">
                {group.title}: {group.recorded} of {group.total} shots recorded
                · {group.unrecorded} not recorded
              </p>
            )}
            <div
              className="overflow-x-auto"
              role="region"
              aria-label={group.title}
              tabIndex={0}
            >
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[
                      "Observation",
                      "Share of recorded",
                      "Shooting %",
                      "Miss rate",
                    ].map((label) => (
                      <th key={label} scope="col" className="p-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows
                    .filter((r) => !compact || r.count > 0)
                    .map((r) => (
                      <tr key={r.label} className="border-t border-slate-600">
                        <th scope="row" className="p-3">
                          {r.label}
                        </th>
                        <td className="p-3">
                          {rate(r.percent, r.count, group.recorded)}
                        </td>
                        <td className="p-3">
                          {rate(r.shooting, r.points, r.graded * 5)}
                          <span className="block text-xs text-slate-400">
                            {r.graded} graded shots · points / possible
                          </span>
                        </td>
                        <td className="p-3">
                          {rate(r.missPercent, r.misses, r.classified)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </section>
  );
}
