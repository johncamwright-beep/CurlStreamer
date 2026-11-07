import {
  difficultyCaveat,
  difficultyDescription,
  difficultyLabels,
  difficultyPercent,
  difficultyPAE,
  type DifficultySummary as Summary,
} from "@/lib/curlcoach/difficulty";

export default function DifficultySummary({
  value,
  compact = false,
}: {
  value: Summary;
  compact?: boolean;
}) {
  return (
    <div
      className="text-sm space-y-2"
      aria-label="Difficulty-adjusted shooting"
    >
      <p>{difficultyDescription(value)}</p>
      {!compact && (
        <>
          <p>
            Classified shots: actual {difficultyPercent(value.actual)} ·
            expected {difficultyPercent(value.expected)} · reference baseline{" "}
            {difficultyPercent(value.benchmarks.baseline)}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="text-left">
                Difficulty mix and shooting on classified shots
              </caption>
              <thead>
                <tr>
                  <th>Difficulty</th>
                  <th>Shots / mix</th>
                  <th>Actual</th>
                  <th>Expected</th>
                  <th>Above expected</th>
                </tr>
              </thead>
              <tbody>
                {value.mix.map((row) => (
                  <tr key={row.level}>
                    <th>
                      {row.level} — {difficultyLabels[row.level]}
                    </th>
                    <td>
                      {row.count} / {difficultyPercent(row.share)}
                    </td>
                    <td>{difficultyPercent(row.actual)}</td>
                    <td>{difficultyPercent(row.expected)}</td>
                    <td>
                      {difficultyPAE(
                        row.actual === null ? null : row.actual - row.expected,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="opacity-80">
        {difficultyCaveat} Benchmark set: {value.benchmarks.version}.
      </p>
    </div>
  );
}
