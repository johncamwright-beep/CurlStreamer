import { assessmentCoverage } from "@/lib/curlcoach/assessment-coverage";
import type { Shot } from "@/lib/curlcoach/model";
import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";

export function AssessmentCoverage({
  shots,
  documents,
}: {
  shots: (Shot & { id: string })[];
  documents: EnhancedDocument[];
}) {
  return (
    <details className="coach-panel enhanced-coverage">
      <summary>Assessment coverage</summary>
      <p>
        Saved, included attempts in this game. These percentages show how much
        was assessed, not how many shots succeeded. Missing calls and excluded
        attempts do not establish opportunities.
      </p>
      {assessmentCoverage(shots, documents).map((row) => (
        <div key={row.group}>
          <strong>
            {row.name}: {row.assessed} / {row.eligible} assessed
            {row.eligible
              ? ` (${Math.round((100 * row.assessed) / row.eligible)}%)`
              : " — no known opportunities"}
          </strong>
          <p>
            {row.unassessed} unassessed · {row.notApplicable} not applicable
            {row.unknownCall
              ? ` · ${row.unknownCall} calls not recorded or unavailable`
              : ""}
            {row.needsReview ? ` · ${row.needsReview} need review` : ""}
          </p>
        </div>
      ))}
    </details>
  );
}
