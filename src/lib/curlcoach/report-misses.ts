import { currentShots, shotTypes, turns, type Shot } from "./model";
import type { CoachEvent } from "./event";
export const missTags = [
  "Light",
  "Heavy",
  "Undercurl",
  "Overcurl",
  "Management",
] as const;
const isMiss = (s: Shot) =>
  ["Partial", "Limited", "Xmiss"].includes(s.execution ?? "");
const eligible = (shots: Shot[]) =>
  shots.filter((s) => !s.excluded && s.execution !== null);
const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 1000) / 10 : null;
function row(label: string, shots: Shot[]) {
  const classified = eligible(shots),
    misses = classified.filter(isMiss);
  const tags = missTags.map((tag) => ({
    tag,
    count: misses.filter((s) => s.deficiency === tag).length,
  }));
  const highest = Math.max(0, ...tags.map((t) => t.count));
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
    smallSample: classified.length < 10,
  };
}
export function reportMisses(event: CoachEvent, playerId?: string) {
  const selected = (shots: Shot[]) =>
    shots.filter((s) => !playerId || s.playerId === playerId);
  const shots = selected(
    event.games.flatMap((g) => currentShots(g.state.events)),
  );
  const classified = eligible(shots),
    misses = classified.filter(isMiss);
  const categories = missTags.map((tag) => ({
    tag,
    count: misses.filter((s) => s.deficiency === tag).length,
    percent: pct(
      misses.filter((s) => s.deficiency === tag).length,
      misses.length,
    ),
  }));
  const tagged = categories.reduce((n, c) => n + c.count, 0);
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
  const practice = ranked.slice(0, 2).map((c) => ({
    tag: c.tag,
    ...drills[c.tag],
    target:
      shotTypes
        .map((type) => ({
          type,
          n: misses.filter((s) => s.type === type && s.deficiency === c.tag)
            .length,
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
      row(`Game ${i + 1}`, selected(currentShots(g.state.events))),
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
