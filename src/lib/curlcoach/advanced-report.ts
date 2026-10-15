import { currentShots, report, type Shot, type State } from "./model";
import {
  catalogue,
  label,
  standardConflicts,
  supplementSchema,
  type Supplement,
} from "./enhanced-catalog";
import { shotSubtypes, weightLabels, resultLabels } from "./shot-subtypes";
import {
  difficultyIdentity,
  difficultySummary,
  type DifficultyShot,
} from "./difficulty";
import { resultRelevant } from "./result-entry";
import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";
import type { CoachEvent } from "./event";
import type { Evidence } from "./reports";

// Enumerated observations only. Never project coach notes, instructions, paths,
// venue names, raw video links or arbitrary text into model evidence.
const fields = [
  "shotSubtype",
  "intendedWeight",
  "observedDestination",
  "resultObservations",
  "observedWeight",
  "contactPlan",
  "contactResult",
  "intendedRoll",
  "rollResult",
  "intendedTargets",
  "removedTargets",
  "intendedRelease",
  "misses",
  "additionalDeficiencies",
  "additionalTechnical",
  "tolerance",
  "toleranceResult",
  "guardToClear",
] as const;
export type AdvancedRecord = {
  shotId: string;
  identity: string;
  revision: number;
  valid: boolean;
  needsReview: boolean;
  values: Supplement["values"];
  assessments: Supplement["assessments"];
};
export type AdvancedReport = {
  included: number;
  recorded: number;
  unavailable: number;
  needsReview: number;
  groups: { title: string; metrics: Evidence[] }[];
};

export function advancedRecords(
  state: State,
  docs: EnhancedDocument[],
): AdvancedRecord[] {
  const latest = new Map<string, EnhancedDocument>();
  for (const doc of docs)
    if (
      doc.kind === "supplement" &&
      doc.shotId &&
      (!latest.has(doc.shotId) ||
        latest.get(doc.shotId)!.revision < doc.revision)
    )
      latest.set(doc.shotId, doc);
  return currentShots(state.events).flatMap((shot) => {
    const doc = latest.get(shot.id);
    if (!doc) return [];
    const parsed = supplementSchema.safeParse(doc.value);
    const original = state.events.find(
      (e) => e.shotId === shot.id && e.revision === doc.sourceRevision,
    )?.shot;
    const conflicts = [
      ...(doc.conflicts ?? []),
      ...(parsed.success ? standardConflicts(parsed.data, shot) : []),
    ];
    const valid = !!(
      parsed.success &&
      original &&
      difficultyIdentity(original) === difficultyIdentity(shot) &&
      !conflicts.some((c) => c.startsWith("source "))
    );
    const values: Supplement["values"] = {};
    const assessments: Supplement["assessments"] = {};
    if (valid && parsed.success) {
      for (const key of fields) {
        const group = catalogue[key].group as
          keyof Supplement["assessments"] | undefined;
        if (conflicts.some((c) => c === key || c.startsWith(`${key} `)))
          continue;
        if (
          group &&
          (conflicts.some((c) => c === group || c.startsWith(`${group} `)) ||
            (original &&
              ["line", "release", "technical", "deficiency"].includes(group) &&
              original[group as keyof Shot] !== shot[group as keyof Shot]))
        )
          continue;
        if (group) assessments[group] = parsed.data.assessments[group];
        if (
          parsed.data.values[key] !== undefined &&
          (!group || assessments[group] === "assessed")
        )
          values[key] = parsed.data.values[key];
      }
    }
    return [
      {
        shotId: shot.id,
        identity: difficultyIdentity(shot),
        revision: doc.revision,
        valid,
        needsReview: !valid || conflicts.length > 0,
        values,
        assessments,
      },
    ];
  });
}

type Row = { shot: DifficultyShot; record?: AdvancedRecord };
export function advancedReport(
  event: CoachEvent,
  playerId?: string,
  prefix = "advanced",
  includeAssessedZeroes = false,
): AdvancedReport {
  const rows: Row[] = [];
  let unavailable = 0,
    needsReview = 0;
  for (const game of event.games) {
    for (const shot of currentShots(game.state.events).filter(
      (s) => !s.excluded && (!playerId || s.playerId === playerId),
    )) {
      const candidate = game.advancedRecords?.find((r) => r.shotId === shot.id);
      const valid =
        candidate?.valid && candidate.identity === difficultyIdentity(shot);
      if (!game.advancedReady) unavailable++;
      else if (candidate && (!valid || candidate.needsReview)) needsReview++;
      const difficulty = game.difficultyRecords?.find(
        (r) => r.shotId === shot.id && r.identity === difficultyIdentity(shot),
      );
      rows.push({
        shot: {
          ...shot,
          difficulty: difficulty?.level,
          difficultyUnavailable: !game.difficultyReady,
        },
        record: game.advancedReady && valid ? candidate : undefined,
      });
    }
  }
  const groups: AdvancedReport["groups"] = [];
  const addGroup = (title: string) => {
    const group = { title, metrics: [] as Evidence[] };
    groups.push(group);
    return group.metrics;
  };
  const add = (
    target: Evidence[],
    suffix: string,
    name: string,
    count: number,
    total: number,
    unit: "shots" | "points" = "shots",
    sample = total,
  ) => {
    if (!total) return;
    target.push({
      id: `${prefix}-${suffix}`,
      label: name,
      value: `${((100 * count) / total).toFixed(1)}% (${count} of ${total} ${unit})`,
      sample,
      confidence: sample < 10 ? "small" : sample < 20 ? "tentative" : "event",
      basis: {
        numerator: count,
        denominator: total,
        unit,
        ...(unit === "points" ? { shots: sample } : {}),
      },
    });
  };
  const validRows = rows.filter((r) => r.record);
  const coverage = addGroup("Advanced observation coverage");
  add(
    coverage,
    "coverage",
    "Included shots with a validated Enhanced record",
    validRows.length,
    rows.length,
  );
  const value = (r: Row, key: string) => r.record?.values[key];
  const assessed = (r: Row, key: string) => {
    const group = catalogue[key].group as
      keyof Supplement["assessments"] | undefined;
    return (
      value(r, key) !== undefined &&
      (!group || r.record?.assessments[group] === "assessed")
    );
  };
  for (const key of [
    "observedDestination",
    "resultObservations",
    "contactResult",
    "rollResult",
    "removedTargets",
  ] as const) {
    const group = catalogue[key].group as keyof Supplement["assessments"];
    const pool = rows.filter(
      (r) =>
        r.record?.assessments[group] !== "not_applicable" &&
        resultRelevant(r.record?.values ?? {}, key),
    );
    add(
      coverage,
      `coverage-${key}`,
      `${catalogue[key].label}: assessed / known applicable shots`,
      pool.filter((r) => assessed(r, key)).length,
      pool.length,
    );
  }
  const distribution = (
    title: string,
    key: string,
    options: Record<string, string>,
    pool = validRows,
    suffix = key,
  ) => {
    const eligible = pool.filter((r) => assessed(r, key));
    if (!eligible.length) return;
    const metrics = addGroup(title);
    for (const [code, name] of Object.entries(options)) {
      const selected = eligible.filter((r) =>
        Array.isArray(value(r, key))
          ? (value(r, key) as string[]).includes(code)
          : value(r, key) === code,
      );
      if (selected.length || includeAssessedZeroes)
        add(
          metrics,
          `${suffix}-${code}`,
          `${title}: ${name}`,
          selected.length,
          eligible.length,
        );
    }
    if (key === "resultObservations" || key === "misses")
      add(
        metrics,
        `${suffix}-none`,
        `${title}: explicit no observed miss`,
        eligible.filter((r) => (value(r, key) as string[]).length === 0).length,
        eligible.length,
      );
  };
  const subtypes = addGroup("Shot subtype performance");
  for (const subtype of shotSubtypes) {
    const pool = validRows.filter(
      (r) => value(r, "shotSubtype") === subtype.id,
    );
    if (!pool.length) continue;
    const stats = report(pool.map((r) => r.shot));
    add(
      subtypes,
      `subtype-${subtype.id}`,
      `${subtype.name}: shooting`,
      pool.reduce((n, r) => n + (r.shot.grade ?? 0), 0),
      5 * stats.scored,
      "points",
      stats.scored,
    );
    const classified = pool.filter((r) => r.shot.execution !== null);
    add(
      subtypes,
      `execution-${subtype.id}`,
      `${subtype.name}: Partial / Limited / Miss outcomes`,
      classified.filter((r) => r.shot.execution !== "Make").length,
      classified.length,
    );
    const d = difficultySummary(pool.map((r) => r.shot));
    if (d.classified)
      subtypes.push({
        id: `${prefix}-difficulty-${subtype.id}`,
        label: `${subtype.name}: difficulty context`,
        value: `Actual ${d.actual!.toFixed(1)}%; expected ${d.expected!.toFixed(1)}%; adjusted ${d.adjusted!.toFixed(1)}%; ${d.classified} classified of ${d.eligible} graded; mix ${d.mix.map((m) => `${m.level}: ${m.count}`).join(", ")}. Provisional illustrative expectations.`,
        sample: d.classified,
        confidence:
          d.classified < 10
            ? "small"
            : d.classified < 20
              ? "tentative"
              : "event",
      });
    distribution(
      `${subtype.name} results`,
      "resultObservations",
      resultLabels,
      pool,
      `results-${subtype.id}`,
    );
  }
  distribution("Result observations", "resultObservations", resultLabels);
  distribution(
    "Observed weight destinations",
    "observedDestination",
    weightLabels,
  );
  const weights = addGroup("Called and observed weight");
  const paired = validRows.filter(
    (r) =>
      typeof value(r, "intendedWeight") === "string" &&
      assessed(r, "observedDestination"),
  );
  // Each call has its own denominator. Weight categories are never subtracted.
  for (const called of catalogue.intendedWeight.choices!) {
    const pool = paired.filter((r) => value(r, "intendedWeight") === called);
    for (const [observed, name] of Object.entries(weightLabels)) {
      const n = pool.filter(
        (r) => value(r, "observedDestination") === observed,
      ).length;
      if (n)
        add(
          weights,
          `weight-${called}-${observed}`,
          `Called ${weightLabels[called] ?? label(called)}; observed ${name}`,
          n,
          pool.length,
        );
    }
  }
  distribution(
    "Historical weight assessment",
    "observedWeight",
    Object.fromEntries(
      catalogue.observedWeight.choices!.map((v) => [v, label(v)]),
    ),
  );
  for (const key of [
    "contactResult",
    "rollResult",
    "toleranceResult",
    "misses",
    "additionalDeficiencies",
    "additionalTechnical",
  ] as const)
    distribution(
      catalogue[key].label,
      key,
      Object.fromEntries(catalogue[key].choices!.map((v) => [v, label(v)])),
      validRows.filter((r) => resultRelevant(r.record!.values, key)),
    );
  const removal = addGroup("Target removal");
  const removalRows = validRows.filter(
    (r) =>
      resultRelevant(r.record!.values, "removedTargets") &&
      assessed(r, "removedTargets"),
  );
  add(
    removal,
    "removal-complete",
    "All nominated targets removed / assessed removal calls",
    removalRows.filter(
      (r) => value(r, "removedTargets") === value(r, "intendedTargets"),
    ).length,
    removalRows.length,
  );
  const releases = addGroup("Called and observed release");
  const releaseRows = validRows.filter(
    (r) => value(r, "intendedRelease") && r.shot.release,
  );
  for (const called of catalogue.intendedRelease.choices!) {
    const pool = releaseRows.filter(
      (r) => value(r, "intendedRelease") === called,
    );
    for (const observed of catalogue.intendedRelease.choices!) {
      const n = pool.filter((r) => r.shot.release === observed).length;
      if (n)
        add(
          releases,
          `release-${called.replaceAll(" ", "_")}-${observed.replaceAll(" ", "_")}`,
          `Called ${called}; observed ${observed}`,
          n,
          pool.length,
        );
    }
  }
  return {
    included: rows.length,
    recorded: validRows.length,
    unavailable,
    needsReview,
    groups: groups.filter((g) => g.metrics.length),
  };
}

/** Bound prompt size while keeping all calculated rows in the saved report. */
export function advancedEvidence(
  summary: AdvancedReport,
  limit = 80,
): Evidence[] {
  const queues = summary.groups.map((g) =>
    [...g.metrics].sort(
      (a, b) => b.sample - a.sample || a.id.localeCompare(b.id),
    ),
  );
  const result: Evidence[] = [];
  while (result.length < limit && queues.some((q) => q.length))
    for (const queue of queues) {
      if (result.length >= limit) break;
      const row = queue.shift();
      if (row) result.push(row);
    }
  return result;
}

export const ADVANCED_REPORT_INSTRUCTIONS = `Use supplied advanced evidence to connect the recorded call, subtype, result observations and delivery observations. Prioritize recurring supported subtype, weight and result patterns in strengths, priorities and practice. Use same-subtype and same-game evidence for specific claims. Called-versus-observed weight rows are categorical distributions within that call, not distances or automatic light/heavy assessments. A matching destination is not proof of a made shot. Multiple result tags can apply to one shot: their shares may total more than one hundred percent. Explicit no observed miss differs from unassessed; neither establishes correct technique. Compare subtype shooting with its recorded difficulty mix where available. Contact, roll and target-removal rates require recorded applicable calls and assessed results. Intended-versus-observed release is context, not a mechanical diagnosis. Sparse observations are tentative; unavailable or conflicting records do not establish success or failure. Aggregate associations are not causal explanations. Do not invent ice-condition effects or adjustment effectiveness. All detailed tables are rendered separately; only the supplied evidence subset is available for narrative. When advanced evidence supports a priority, connect a specific rehearsal or video-review check to it instead of falling back to generic drills.`;
