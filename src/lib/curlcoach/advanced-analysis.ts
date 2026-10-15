import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";
import { difficultyIdentity } from "./difficulty";
import { standardConflicts, supplementSchema } from "./enhanced-catalog";
import { difficultyEventShots, type CoachEvent } from "./event";
import { currentShots, type State } from "./model";

export type AnalysisAssessment =
  "assessed" | "not_assessed" | "not_applicable" | "conflicted" | "unavailable";
export type AnalysisStatus =
  "available" | "missing" | "invalid" | "conflicted" | "unavailable";
type AnalysisFields = {
  shotSubtype: string | null;
  intendedWeight: string | null;
  observedDestination: string | null;
  /** null is unassessed; [] explicitly records no observed miss. */
  resultObservations: string[] | null;
  destinationAssessment: AnalysisAssessment;
  resultAssessment: AnalysisAssessment;
  analysisStatus: AnalysisStatus;
};
export type AnalysisRecord = AnalysisFields & {
  shotId: string;
  identity: string;
  revision: number;
};
export type AnalysisShot = ReturnType<typeof difficultyEventShots>[number] &
  AnalysisFields & { analysisUnavailable: boolean };

function emptyFields(analysisStatus: AnalysisStatus): AnalysisFields {
  const assessment =
    analysisStatus === "unavailable"
      ? "unavailable"
      : analysisStatus === "conflicted"
        ? "conflicted"
        : "not_assessed";
  return {
    shotSubtype: null,
    intendedWeight: null,
    observedDestination: null,
    resultObservations: null,
    destinationAssessment: assessment,
    resultAssessment: assessment,
    analysisStatus,
  };
}

/** Project a fixed allowlist from the latest revision; never resurrect superseded observations. */
export function analysisRecords(
  state: State,
  documents: EnhancedDocument[],
): AnalysisRecord[] {
  const latest = new Map<string, EnhancedDocument>();
  for (const doc of documents) {
    if (doc.kind !== "supplement" || !doc.shotId) continue;
    if (
      !latest.has(doc.shotId) ||
      latest.get(doc.shotId)!.revision < doc.revision
    )
      latest.set(doc.shotId, doc);
  }
  return currentShots(state.events).flatMap((shot) => {
    const doc = latest.get(shot.id);
    if (!doc) return [];
    const record = {
      shotId: shot.id,
      identity: difficultyIdentity(shot),
      revision: doc.revision,
    };
    const parsed = supplementSchema.safeParse(doc.value);
    if (!parsed.success) return [{ ...record, ...emptyFields("invalid") }];
    const original = state.events.find(
      (event) =>
        event.shotId === shot.id && event.revision === doc.sourceRevision,
    )?.shot;
    const conflicts = [
      ...(doc.conflicts ?? []),
      ...standardConflicts(parsed.data, shot),
    ];
    if (
      !original ||
      difficultyIdentity(original) !== difficultyIdentity(shot) ||
      conflicts.some((c) => c.startsWith("source "))
    )
      return [
        {
          ...record,
          ...emptyFields("conflicted"),
          destinationAssessment: "conflicted" as const,
          resultAssessment: "conflicted" as const,
        },
      ];
    const { values, assessments } = parsed.data;
    const blocked = (group: string, field: string) =>
      conflicts.some(
        (c) =>
          c === group ||
          c === field ||
          c.startsWith(`${group} `) ||
          c.startsWith(`${field} `),
      );
    const destinationAssessment: AnalysisAssessment = blocked(
      "destination",
      "observedDestination",
    )
      ? "conflicted"
      : (assessments.destination ?? "not_assessed");
    const resultAssessment: AnalysisAssessment = blocked(
      "results",
      "resultObservations",
    )
      ? "conflicted"
      : (assessments.results ?? "not_assessed");
    return [
      {
        ...record,
        shotSubtype: blocked("shotSubtype", "shotSubtype")
          ? null
          : typeof values.shotSubtype === "string"
            ? values.shotSubtype
            : null,
        intendedWeight: blocked("intendedWeight", "intendedWeight")
          ? null
          : typeof values.intendedWeight === "string"
            ? values.intendedWeight
            : null,
        observedDestination:
          destinationAssessment === "assessed"
            ? String(values.observedDestination)
            : null,
        resultObservations:
          resultAssessment === "assessed"
            ? [...(values.resultObservations as string[])]
            : null,
        destinationAssessment,
        resultAssessment,
        analysisStatus: conflicts.length
          ? ("conflicted" as const)
          : ("available" as const),
      },
    ];
  });
}

export function analysisEventShots(event: CoachEvent): AnalysisShot[] {
  const games = new Map(event.games.map((game) => [game.id, game]));
  return difficultyEventShots(event).map((shot) => {
    const game = games.get(shot.gameId)!;
    const saved = game.analysisRecords?.find((r) => r.shotId === shot.id);
    const record =
      saved?.identity === difficultyIdentity(shot) ? saved : undefined;
    const fields = game.analysisReady
      ? (record ?? emptyFields(saved ? "conflicted" : "missing"))
      : emptyFields("unavailable");
    // Do not serialize record metadata into the shot or expose arbitrary supplement values.
    return {
      ...shot,
      shotSubtype: fields.shotSubtype,
      intendedWeight: fields.intendedWeight,
      observedDestination: fields.observedDestination,
      resultObservations:
        fields.resultObservations === null
          ? null
          : [...fields.resultObservations],
      destinationAssessment: fields.destinationAssessment,
      resultAssessment: fields.resultAssessment,
      analysisStatus: fields.analysisStatus,
      analysisUnavailable: !game.analysisReady,
    };
  });
}

export function analysisCoverage(shots: AnalysisShot[]) {
  const eligible = shots.filter((shot) => !shot.excluded);
  return {
    eligible: eligible.length,
    subtyped: eligible.filter((shot) => shot.shotSubtype !== null).length,
    calledWeight: eligible.filter((shot) => shot.intendedWeight !== null)
      .length,
    destinationAssessed: eligible.filter(
      (shot) => shot.destinationAssessment === "assessed",
    ).length,
    resultsAssessed: eligible.filter(
      (shot) => shot.resultAssessment === "assessed",
    ).length,
    noObservedMiss: eligible.filter(
      (shot) => shot.resultObservations?.length === 0,
    ).length,
    unavailable: eligible.filter((shot) => shot.analysisUnavailable).length,
  };
}
