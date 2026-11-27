import {
  cellText,
  matrixChange,
  matrixEndpoints,
  matrixPoints,
  matrixScope,
  totalCellFill,
  type ReportMatrix,
} from "@/lib/curlcoach/report-matrix";

export default function ReportComparison({ matrix }: { matrix: ReportMatrix }) {
  return (
    <section className="report-comparison">
      <h4>
        {matrix.title} <small>{matrixScope(matrix)}</small>
      </h4>
      {matrix.narrative && (
        <p className="report-matrix-narrative">{matrix.narrative}</p>
      )}
      {matrix.columns.length > 0 && (
        <div
          className="report-matrix-scroll"
          tabIndex={0}
          role="region"
          aria-label={matrix.title + " comparison table"}
        >
          <table aria-label={matrix.title}>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="report-spark-head">
                  Trend
                  <span className="report-spark-axis">
                    {matrix.columns
                      .filter(
                        (_, i) =>
                          matrix.columns.length <= 5 ||
                          i === 0 ||
                          i === matrix.columns.length - 1,
                      )
                      .map((c) => (
                        <span key={c.key}>{c.key}</span>
                      ))}
                  </span>
                </th>
                {matrix.columns.map((c) => (
                  <th scope="col" key={c.key}>
                    {c.key}
                    <span>{c.name}</span>
                  </th>
                ))}
                <th scope="col" className="report-total-head">
                  Total
                </th>
                <th scope="col">
                  Change<span>{matrixEndpoints(matrix)}</span>
                </th>
              </tr>
            </thead>
            {matrix.groups.map((group) => (
              <tbody key={group.title}>
                <tr className="report-matrix-group">
                  <th scope="rowgroup" colSpan={matrix.columns.length + 4}>
                    {group.title}
                  </th>
                </tr>
                {group.rows.map((row) => {
                  const points = matrixPoints(row);
                  const delta = matrixChange(row);
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>
                        <svg
                          viewBox="0 0 100 24"
                          className="report-spark"
                          aria-hidden="true"
                        >
                          {points.map((p, i) => {
                            if (!p) return null;
                            const prev = points[i - 1],
                              x = 4 + 92 * p.x,
                              y = 3 + 18 * p.y;
                            return (
                              <g key={i}>
                                {prev && (
                                  <line
                                    x1={4 + 92 * prev.x}
                                    y1={3 + 18 * prev.y}
                                    x2={x}
                                    y2={y}
                                  />
                                )}
                                <circle cx={x} cy={y} r={2.4} />
                              </g>
                            );
                          })}
                        </svg>
                      </td>
                      {[...row.cells, row.total].map((c, i) => (
                        <td
                          key={i}
                          className={
                            i === row.cells.length
                              ? "report-matrix-total"
                              : undefined
                          }
                          style={
                            i === row.cells.length
                              ? {
                                  backgroundColor: totalCellFill(
                                    group.metric,
                                    c,
                                  ),
                                }
                              : undefined
                          }
                        >
                          {cellText(c)}
                          {c.sample && <small>({c.sample})</small>}
                        </td>
                      ))}
                      <td
                        className="report-matrix-change"
                        style={{ color: delta.color }}
                      >
                        {delta.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
