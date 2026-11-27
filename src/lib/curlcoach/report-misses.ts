import { shotTypes, turns, type Shot } from "./model";
import type { CoachEvent } from "./event";
import { analysisEventShots, type AnalysisShot } from "./advanced-analysis";
import { label, missChoices } from "./enhanced-catalog";
import { resultLabels } from "./shot-subtypes";

export const missTags = [
  "Light",
  "Heavy",
  "Undercurl",
  "Overcurl",
  "Management",
] as const;
const isMiss = (s: Shot) =>
  ["Partial", "Limited", "Xmiss"].includes(s.execution ?? "");
type MissShot = Shot &
  Partial<
    Pick<
      AnalysisShot,
      "resultObservations" | "observedMisses" | "additionalDeficiencies"
    >
  >;
const eligible = <T extends Shot>(shots: T[]) =>
  shots.filter((s) => !s.excluded && s.execution !== null);
const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 1000) / 10 : null;
function row(label: string, shots: MissShot[]) {
  const { classified, misses, categories: tags } = classifiedMisses(shots);
  const highest = Math.max(0, ...tags.map((tag) => tag.count));
  return {
    label,
    attempts: classified.length,
    misses: misses.length,
    rate: pct(misses.length, classified.length),
    topTag: highest
      ? tags
          .filter((t) => t.count === highest)
          .map((t) => t.tag)
          .join(" / ")
      : "Not tagged",
    topPercent: pct(highest, misses.length),
    topCount: highest,
    smallSample: classified.length < 10,
  };
}
// Only explicit selections are reasons. A weight, destination or note alone is not a tag.
const missAliases: Record<string, string> = {
  over_curl: "overcurl",
  under_curl: "undercurl",
  too_much_contact: "contact_too_thick",
  too_little_contact: "contact_too_thin",
  roll_far: "roll_too_far",
  roll_short: "roll_not_far_enough",
  flash_with_side_unclear: "flash",
};
export function taggedMissLabels(shot: MissShot) {
  const codes = new Set<string>();
  for (const reason of [
    shot.deficiency,
    ...(shot.additionalDeficiencies ?? []),
  ]) {
    if (reason && missTags.some((tag) => tag === reason))
      codes.add(reason.toLowerCase());
  }
  for (const code of shot.resultObservations ?? []) {
    if (Object.hasOwn(resultLabels, code)) codes.add(missAliases[code] ?? code);
  }
  for (const code of missChoices) {
    if (shot.observedMisses?.includes(code))
      codes.add(missAliases[code] ?? code);
  }
  if (
    codes.has("wreck_on_guard") ||
    codes.has("wreck_on_another_unintended_stone")
  ) {
    codes.delete("wreck");
    codes.delete("wreck_stone");
  }
  if (codes.has("wreck_stone")) codes.delete("wreck");
  if (codes.has("flash_wide") || codes.has("flash_narrow"))
    codes.delete("flash");
  return [
    ...new Set([...codes].map((code) => resultLabels[code] ?? label(code))),
  ];
}

type ReasonCounts = { tagged: number; counts: Record<string, number> };
function recordReasons(group: ReasonCounts, reasons: string[]) {
  group.tagged++;
  for (const reason of reasons)
    group.counts[reason] = (group.counts[reason] ?? 0) + 1;
}

export function shotReviewStats(shots: MissShot[]) {
  const outcomes = { Make: 0, Partial: 0, Limited: 0, Xmiss: 0 };
  const reasons: ReasonCounts = { tagged: 0, counts: {} };
  const missPatternsByShot: Record<string, ReasonCounts> = {};
  for (const shot of shots) {
    if (shot.excluded) continue;
    if (shot.execution) outcomes[shot.execution]++;
    const labels = taggedMissLabels(shot);
    if (!labels.length) continue;
    recordReasons(reasons, labels);
    if (shot.type)
      recordReasons(
        (missPatternsByShot[shot.type] ??= { tagged: 0, counts: {} }),
        labels,
      );
  }
  return { outcomes, reasons, missPatternsByShot };
}
export function rankedMissReasons(counts: Record<string, number>) {
  return Object.entries(counts).sort(
    ([a, n], [b, m]) => m - n || a.localeCompare(b),
  );
}
export function recurringMissPairs(byShot: Record<string, ReasonCounts>) {
  return Object.entries(byShot)
    .flatMap(([type, group]) =>
      Object.entries(group.counts)
        .filter(([, count]) => count >= 2)
        .map(([tag, count]) => ({ type, tag, count, tagged: group.tagged })),
    )
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.type.localeCompare(b.type) ||
        a.tag.localeCompare(b.tag),
    )
    .slice(0, 15);
}
export const outcomeLabel = (execution: NonNullable<Shot["execution"]>) =>
  execution === "Xmiss" ? "Complete miss" : execution;
function classifiedMisses(shots: MissShot[]) {
  const classified = eligible(shots),
    misses = classified.filter(isMiss);
  const counts: Record<string, number> = {};
  const reasons: ReasonCounts = { tagged: 0, counts };
  for (const shot of misses) {
    const labels = taggedMissLabels(shot);
    if (labels.length) recordReasons(reasons, labels);
  }
  const tagged = reasons.tagged;
  const categories = rankedMissReasons(counts).map(([tag, count]) => ({
    tag,
    count,
    percent: pct(count, misses.length),
  }));
  return {
    classified,
    misses,
    tagged,
    categories,
  };
}
export function missCounts(shots: Shot[]) {
  const { classified, misses, tagged, categories } = classifiedMisses(shots);
  return {
    classified: classified.length,
    misses: misses.length,
    tagged,
    categories,
    fullMisses: misses.filter((s) => s.execution === "Xmiss").length,
  };
}
export function reportMisses(
  event: CoachEvent,
  playerId?: string,
  charted = analysisEventShots(event),
) {
  const shots = charted.filter(
    (shot) => !playerId || shot.playerId === playerId,
  );
  const { classified, misses, tagged, categories } = classifiedMisses(shots);
  const ranked = categories
    .filter((c) => c.count)
    .sort((a, b) => b.count - a.count);
  const leaders = ranked.filter((c) => c.count === ranked[0]?.count);
  const rate = pct(misses.length, classified.length);
  const focus = !classified.length
    ? "There are no classified execution outcomes to assess misses yet."
    : !misses.length
      ? "No partial, limited or missed outcomes were recorded in the classified shots."
      : !ranked.length
        ? "Miss outcomes were recorded, but without directional tags there is not enough information to identify a weight or line pattern."
        : `${leaders.map((c) => c.tag).join(" and ")} ${leaders.length > 1 ? "tie as the most frequent recorded miss categories" : "is the most frequent recorded miss category"} (${leaders[0].percent?.toFixed(1)}% of miss outcomes${leaders.length > 1 ? " each" : ""}). ${misses.length < 10 ? "Treat this as a small-sample practice lead, not an established tendency." : "Use this as a practice priority, then check whether it repeats across games."}`;
  const practice = ranked
    .filter((c): c is typeof c & { tag: keyof typeof drills } =>
      Object.hasOwn(drills, c.tag),
    )
    .slice(0, 2)
    .map((c) => ({
      tag: c.tag,
      ...drills[c.tag],
      target:
        shotTypes
          .map((type) => ({
            type,
            n: misses.filter(
              (s) => s.type === type && taggedMissLabels(s).includes(c.tag),
            ).length,
          }))
          .filter((r) => r.n > 0)
          .sort((a, b) => b.n - a.n)[0]?.type ?? "the charted shot types",
    }));
  return {
    classified: classified.length,
    misses: misses.length,
    rate,
    tagged,
    categories,
    untaggedPercent: pct(misses.length - tagged, misses.length),
    focus,
    byShot: shotTypes
      .map((t) =>
        row(
          t,
          shots.filter((s) => s.type === t),
        ),
      )
      .filter((r) => r.attempts),
    byTurn: turns
      .map((t) =>
        row(
          t,
          shots.filter((s) => s.turn === t),
        ),
      )
      .filter((r) => r.attempts),
    byGame: event.games.map((g, i) =>
      row(
        g.label || `Game ${i + 1}`,
        shots.filter((shot) => shot.gameId === g.id),
      ),
    ),
    practice,
    definition:
      "Miss rate includes Partial, Limited and Miss outcomes among shots with an execution label. Category shares use those miss outcomes, including untagged misses. Excluded shots do not count. Tags describe outcomes, not proven technical causes.",
  };
}
export type MissAnalysis = ReturnType<typeof reportMisses>;
const drills = {
  Light: {
    title: "Weight calibration",
    setup:
      "Agree on the intended weight for the affected shot and repeat it on the same path with both turns. Record a consistent timing interval and whether the delivered weight was light, on target or heavy.",
    measure:
      "Compare the share judged light across two equal sets. Adjust one agreed cue at a time; treat improvement as a practice observation, not proof of the cause.",
  },
  Heavy: {
    title: "Weight-control sets",
    setup:
      "Repeat an agreed weight for the affected shot. State the intended result before delivery and record heavy, on-target or light after every attempt.",
    measure:
      "Repeat the same set and compare heavy deliveries. Keep the target and ice path consistent enough for the comparison to be useful.",
  },
  Undercurl: {
    title: "Line-and-finish check",
    setup:
      "Repeat the affected shot type on one path. Have a partner separately record delivery toward the broom and the final curl. Keep the intended weight and turn consistent.",
    measure:
      "Compare undercurl outcomes across equal sets. Review alignment, release, ice and sweeping separately rather than assuming the miss identifies a delivery fault.",
  },
  Overcurl: {
    title: "Controlled curl comparison",
    setup:
      "Repeat the affected shot type with the same target, intended weight and turn. Record the initial line and the final curl separately before adjusting one variable.",
    measure:
      "Compare overcurl outcomes across equal sets. Use video or a coach's observation to test possible explanations before changing technique.",
  },
  Management: {
    title: "Call-plan-review repetitions",
    setup:
      "Recreate a relevant game situation. Agree on the intended result, acceptable miss, weight call and communication plan before each attempt.",
    measure:
      "After each attempt, compare the outcome with the shared plan. Track whether the same management issue recurs; the tag alone cannot identify who or what caused it.",
  },
};
