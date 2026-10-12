import { z } from "zod";
import { releases, technicals, type Shot } from "./model";

export const ENHANCED_VERSION = "enhanced-v1" as const;
export function captureError(
  error: unknown,
  fallback = "Save not confirmed. Please retry.",
) {
  return error instanceof z.ZodError
    ? [...new Set(error.issues.map((issue) => issue.message))].join(" ")
    : error instanceof Error
      ? error.message
      : fallback;
}
export type Field = {
  label: string;
  choices?: readonly string[];
  multiple?: boolean;
  max?: number;
  number?: boolean;
  group?: string;
  location: "Live" | "Review" | "Setup";
  meaning: string;
  example: string;
};
const field = (
  label: string,
  choices: readonly string[],
  location: Field["location"],
  meaning: string,
  group?: string,
): Field => ({ label, choices, location, meaning, group, example: choices[0] });
export const detailMappings: Record<string, Shot["type"]> = {
  guard: "Guard/Front Stone",
  open_draw: "Draw",
  come_around_draw: "Come Around",
  angle: "Angle/Freeze",
  freeze: "Angle/Freeze",
  tap: "Tap/Split",
  split: "Tap/Split",
  tick: "Tap/Split",
  hit_and_stay: "Hit & Stay",
  hit_and_roll: "Hit & Roll",
  finesse_hit: "Finesse Hit",
  single_peel: "Peel",
  double_peel: "Peel",
  straight_runback: "Runback/Multiple",
  angle_runback: "Runback/Multiple",
  double_takeout: "Runback/Multiple",
  triple_or_multiple_takeout: "Runback/Multiple",
  runback_double: "Runback/Multiple",
  runback_multiple: "Runback/Multiple",
  other_detail: null,
};
export const label = (code: string) =>
  code.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const missChoices = [
  "wreck_on_guard",
  "wreck_on_another_unintended_stone",
  "flash_wide",
  "flash_narrow",
  "flash_with_side_unclear",
  "contact_too_thick",
  "contact_too_thin",
  "roll_too_far",
  "roll_not_far_enough",
  "roll_wrong_direction",
  "shooter_lost_when_intended_to_stay",
  "intended_targets_not_removed",
  "failed_to_freeze",
  "failed_to_bury",
  "through_house_unintentionally",
  "other_observable_miss",
] as const;
export const catalogue: Record<string, Field> = {
  detail: field(
    "Detailed shot",
    Object.keys(detailMappings),
    "Live",
    "Suggested Standard mapping applies only to a new shot with no Standard type. Not further classified leaves this blank.",
  ),
  detailOther: {
    label: "Other shot detail",
    max: 200,
    location: "Live",
    meaning: "Required for Other detail.",
    example: "Raise and roll",
  },
  intendedWeight: field(
    "Intended weight",
    [
      "1_guard",
      "2_guard",
      "3_guard",
      "top_12",
      "top_8",
      "top_4",
      "button",
      "back_button",
      "back_4",
      "back_8",
      "back_12",
      "back_line",
      "control_weight_takeout",
      "normal_weight_takeout",
      "peel_takeout",
      "takeout_weight_unspecified",
    ],
    "Live",
    "Called destination or takeout weight; these are categories, not a numeric scale.",
  ),
  contactPlan: field(
    "Contact plan",
    [
      "no_intended_stone_contact",
      "direct_contact_with_target",
      "raise_or_runback_through_first_stone",
    ],
    "Live",
    "The first intended contact, not downstream targets.",
  ),
  guardToClear: field(
    "Guard to clear",
    ["yes", "no"],
    "Live",
    "An unwanted guard on the approach that the called shot should avoid.",
  ),
  intendedRoll: field(
    "Intended roll",
    [
      "stay_or_nose",
      "roll_left",
      "roll_right",
      "roll_direction_unspecified",
      "no_roll_requirement",
    ],
    "Review",
    "Left and right are viewed from the hack toward the playing end.",
  ),
  intendedTargets: {
    label: "Intended targets to remove",
    number: true,
    max: 15,
    location: "Review",
    meaning: "Nominated targets, 0–15; blank means unknown.",
    example: "2",
  },
  intendedRelease: field(
    "Intended release",
    releases,
    "Review",
    "Called release, distinct from the existing observed release.",
  ),
  difficulty: field(
    "Shot difficulty",
    ["routine", "demanding", "very_demanding"],
    "Review",
    "Assess the call before its outcome. Late entry is retrospective.",
  ),
  tolerance: field(
    "Available tolerance",
    ["wide", "normal", "tight"],
    "Review",
    "Called margin; not inferred from a miss.",
  ),
  observedWeight: field(
    "Observed weight",
    ["light", "on_target", "heavy"],
    "Live",
    "An explicit weight assessment, independent of grade.",
    "weight",
  ),
  weightBasis: field(
    "Weight assessment basis",
    [
      "coach_observation",
      "timing",
      "unobstructed_finish",
      "other_recorded_basis",
    ],
    "Review",
    "Evidence for the weight observation.",
  ),
  weightBasisOther: {
    label: "Other weight basis",
    max: 200,
    location: "Review",
    meaning: "Required for Other recorded basis.",
    example: "Measured split",
  },
  contactResult: field(
    "First contact result",
    [
      "intended_first_contact_made",
      "intended_first_contact_missed",
      "approach_interrupted_before_intended_contact",
    ],
    "Review",
    "Flash and thickness observations describe this same first contact.",
    "contact",
  ),
  rollResult: field(
    "Roll result",
    [
      "as_called",
      "too_far",
      "not_far_enough",
      "wrong_direction",
      "shooter_lost",
      "other_recorded_result",
    ],
    "Review",
    "Observed result against the called roll.",
    "roll",
  ),
  rollOther: {
    label: "Other roll result",
    max: 200,
    location: "Review",
    meaning: "Required for Other recorded result.",
    example: "Rolled behind a different stone",
  },
  removedTargets: {
    label: "Nominated targets actually removed",
    number: true,
    max: 15,
    location: "Review",
    group: "removal",
    meaning: "Cannot exceed the called count.",
    example: "1",
  },
  toleranceResult: field(
    "Tolerance result",
    ["within_called_tolerance", "outside_called_tolerance"],
    "Review",
    "Assessed against a recorded called tolerance.",
    "tolerance",
  ),
  misses: {
    ...field(
      "Observed miss details",
      missChoices,
      "Live",
      "Assessed with no selection explicitly means no listed miss; unassessed is unknown.",
      "misses",
    ),
    multiple: true,
  },
  primaryMiss: field(
    "Primary observed miss",
    missChoices,
    "Live",
    "Choose the first disruption from the recorded miss details.",
  ),
  missOther: {
    label: "Other observable miss",
    max: 200,
    location: "Live",
    meaning: "Required when Other observable miss is selected.",
    example: "Stopped on an unintended stone",
  },
  additionalDeficiencies: {
    ...field(
      "Additional deficiencies",
      ["Light", "Heavy", "Undercurl", "Overcurl", "Management"],
      "Review",
      "Deduplicate with the existing Standard primary deficiency.",
      "deficiency",
    ),
    multiple: true,
  },
  additionalTechnical: {
    ...field(
      "Additional technical observations",
      technicals,
      "Review",
      "The existing Standard technical observation remains authoritative.",
      "technical",
    ),
    multiple: true,
  },
  broadPath: field(
    "Broad delivery path",
    ["left_outside", "left_inside", "centre", "right_inside", "right_outside"],
    "Live",
    "Viewed from the hack. Broad regions do not prove the same ice line.",
  ),
  namedPath: {
    label: "Named ice path",
    max: 100,
    location: "Review",
    meaning: "Select or name a path for this venue, sheet and direction.",
    example: "Centre port",
  },
  directionOverride: field(
    "Delivery direction override",
    ["a_to_b", "b_to_a"],
    "Review",
    "Audited override; otherwise derived from first-end direction and end number.",
  ),
  directionReason: {
    label: "Direction override reason",
    max: 200,
    location: "Review",
    meaning: "Required for an override.",
    example: "Extra end played toward End A",
  },
  iceSegment: {
    label: "Ice segment",
    max: 100,
    location: "Review",
    meaning:
      "Use a new identifier after maintenance or a major condition change; blank is unknown.",
    example: "After midgame scrape",
  },
  conditionsChanged: field(
    "Conditions changed",
    ["new_ice_segment", "no_change_recorded"],
    "Review",
    "An observed change, not an inferred reason for a miss.",
  ),
  conditionsNote: {
    label: "Conditions note",
    max: 500,
    location: "Review",
    meaning: "Describe maintenance or major change.",
    example: "Sheet scraped",
  },
  conditionsAt: {
    label: "Conditions change time (ISO)",
    max: 40,
    location: "Review",
    meaning: "Timestamp of the observed change.",
    example: "2026-10-12T15:00:00Z",
  },
  source: field(
    "Observation source",
    ["live_entry", "video_review", "coach_retrospective_review", "import"],
    "Review",
    "Recorded provenance. Live calls use live entry; later review is retrospective.",
  ),
  earlierShotId: {
    label: "Earlier shot reference",
    max: 36,
    location: "Review",
    meaning:
      "Existing preceding shot ID in this game; optional adjustment evidence.",
    example: "Choose a preceding recorded shot",
  },
  adjustmentDecision: field(
    "Adjustment decision",
    [
      "adjustment_made",
      "discussed_without_changing_call",
      "intentionally_repeated_call",
    ],
    "Review",
    "Record the decision explicitly; missing is not assessed.",
  ),
  adjustmentTypes: {
    ...field(
      "Recorded adjustment",
      [
        "changed_broom_or_called_ice",
        "changed_requested_weight",
        "changed_release_cue",
        "changed_sweeping_plan",
        "changed_shot_selection",
        "other_recorded_change",
      ],
      "Review",
      "Observed change; does not prove a causal effect.",
    ),
    multiple: true,
  },
  adjustmentOther: {
    label: "Other recorded change",
    max: 200,
    location: "Review",
    meaning: "Required for Other recorded change.",
    example: "Changed the reference point",
  },
  instruction: {
    label: "Adjustment instruction",
    max: 500,
    location: "Review",
    meaning: "The coach's exact recorded instruction.",
    example: "Keep the same weight; move the broom out",
  },
  followUpShotId: {
    label: "Explicit follow-up shot reference",
    max: 36,
    location: "Review",
    meaning: "Existing later shot ID, or use the saved next-opportunity rule.",
    example: "Choose a later recorded shot",
  },
  followUpRule: field(
    "Follow-up selection",
    ["next_same_called_shot", "next_same_called_shot_on_recorded_path"],
    "Review",
    "Saved rule for Prompt 3 sequence evaluation; no evaluation is claimed yet.",
  ),
  visibility: field(
    "Instruction visibility",
    ["coach_private", "team_visible"],
    "Review",
    "Blank defaults to Coach private. Saving never publishes or sends a report.",
  ),
  sourceReconciliation: {
    label: "Source identity reconciliation",
    max: 200,
    location: "Review",
    meaning:
      "Required if the source player or end/stone changed: explain why these observations belong to the corrected shot.",
    example: "Confirmed against the video and corrected lineup",
  },
};
export const setupCatalogue: Record<string, Field> = {
  purpose: field(
    "Record purpose",
    ["competition", "practice"],
    "Setup",
    "Practice remains separate from competition comparisons.",
  ),
  venue: {
    label: "Venue",
    max: 200,
    location: "Setup",
    meaning: "Existing venue ID or coach label; blank is unknown.",
    example: "Rideau",
  },
  sheet: {
    label: "Sheet",
    max: 100,
    location: "Setup",
    meaning: "Existing sheet ID or label.",
    example: "Sheet 2",
  },
  firstDirection: field(
    "First-end delivery direction",
    ["a_to_b", "b_to_a"],
    "Setup",
    "Unknown stays unknown. Later ends alternate only from this recorded direction.",
  ),
  endA: {
    label: "End A label",
    max: 100,
    location: "Setup",
    meaning: "Saved rink direction name.",
    example: "Scoreboard end",
  },
  endB: {
    label: "End B label",
    max: 100,
    location: "Setup",
    meaning: "Saved rink direction name.",
    example: "Window end",
  },
  lastDeliveredSlot: {
    label: "Actual last delivered team rock (if known)",
    number: true,
    max: 160,
    location: "Setup",
    meaning:
      "Actual end/rock sequence slot. Closing a game does not fill missing throws.",
    example: "53",
  },
};
export type Values = Record<string, string | number | string[]>;
export const assessmentStates = [
  "not_assessed",
  "assessed",
  "not_applicable",
] as const;
export const groups = [
  "weight",
  "contact",
  "roll",
  "removal",
  "tolerance",
  "misses",
  "line",
  "release",
  "technical",
  "deficiency",
] as const;
const valuesSchema = (fields: Record<string, Field>) => {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    const choice = field.choices
      ? z.enum([...field.choices] as [string, ...string[]])
      : null;
    shape[key] = (
      field.number
        ? z.number().int().min(0).max(field.max!)
        : field.multiple
          ? z
              .array(choice!)
              .max(field.choices!.length)
              .refine(
                (values) => new Set(values).size === values.length,
                "Choose each observation once.",
              )
          : (choice ?? z.string().max(field.max!))
    ).optional();
  }
  return z
    .object(shape)
    .strict()
    .transform((value) => value as Values);
};
export const contextSchema = valuesSchema(setupCatalogue);
export const supplementSchema = z
  .object({
    version: z.literal(ENHANCED_VERSION),
    mappingVersion: z.literal(ENHANCED_VERSION),
    definitionRevision: z.number().int().nonnegative(),
    contextRevision: z.number().int().nonnegative().default(0),
    contextSnapshot: contextSchema.default({}),
    retrospective: z.boolean().default(true),
    values: valuesSchema(catalogue),
    assessments: z.partialRecord(z.enum(groups), z.enum(assessmentStates)),
  })
  .strict()
  .superRefine((s, ctx) => {
    const v = s.values,
      a = s.assessments;
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const misses = (v.misses ?? []) as string[];
    for (const [key, f] of Object.entries(catalogue))
      if (f.group) {
        const value = v[key];
        if (
          value !== undefined &&
          a[f.group as (typeof groups)[number]] !== "assessed"
        )
          fail(`${f.label} requires an explicit Assessed state.`);
        if (
          a[f.group as (typeof groups)[number]] === "assessed" &&
          value === undefined
        )
          fail(
            `Record ${f.label}${f.multiple ? " or explicitly no listed issue" : ""}.`,
          );
      }
    for (const [key, other, selected] of [
      ["detail", "detailOther", "other_detail"],
      ["weightBasis", "weightBasisOther", "other_recorded_basis"],
      ["rollResult", "rollOther", "other_recorded_result"],
    ])
      if (v[key] === selected && !String(v[other] ?? "").trim())
        fail(`${catalogue[other].label} is required.`);
    if (
      misses.includes("other_observable_miss") &&
      !String(v.missOther ?? "").trim()
    )
      fail("Describe the other observable miss.");
    if (
      misses.length &&
      (!v.primaryMiss || !misses.includes(String(v.primaryMiss)))
    )
      fail("Choose a primary miss from the recorded details.");
    if (!misses.length && v.primaryMiss)
      fail("Primary miss requires a recorded miss detail.");
    const flashes = misses.filter((m) => m.startsWith("flash_"));
    if (flashes.length > 1) fail("Choose one flash direction.");
    if (
      flashes.length &&
      (a.contact !== "assessed" ||
        v.contactResult !== "intended_first_contact_missed")
    )
      fail("A flash requires assessed missed first contact.");
    if (
      v.contactResult === "intended_first_contact_missed" &&
      flashes.length !== 1
    )
      fail(
        "Choose Flash wide, narrow or side unclear for missed first contact.",
      );
    if (
      (flashes.length || v.contactResult === "intended_first_contact_made") &&
      v.contactPlan === "no_intended_stone_contact"
    )
      fail("This contact result contradicts no intended contact.");
    if (
      misses.some((m) => m.startsWith("wreck_")) &&
      (flashes.length || v.contactResult === "intended_first_contact_made")
    )
      fail(
        "A wreck before intended contact cannot also be a flash or made first contact.",
      );
    if (
      misses.some((m) => m.startsWith("contact_too_")) &&
      v.contactResult !== "intended_first_contact_made"
    )
      fail("Thickness requires intended first contact made.");
    if (
      misses.includes("contact_too_thick") &&
      misses.includes("contact_too_thin")
    )
      fail("First contact cannot be both thick and thin.");
    const rollMisses: Record<string, string> = {
      roll_too_far: "too_far",
      roll_not_far_enough: "not_far_enough",
      roll_wrong_direction: "wrong_direction",
      shooter_lost_when_intended_to_stay: "shooter_lost",
    };
    for (const [miss, result] of Object.entries(rollMisses))
      if (misses.includes(miss) && v.rollResult !== result)
        fail("Roll result and miss detail must agree.");
    if (a.misses === "assessed")
      for (const [miss, result] of Object.entries(rollMisses))
        if (v.rollResult === result && !misses.includes(miss))
          fail("The assessed miss list must include the recorded roll miss.");
    if (a.roll === "assessed" && v.intendedRoll === "no_roll_requirement")
      fail("A roll assessment requires a roll or stay requirement.");
    if (
      a.removal === "assessed" &&
      (typeof v.intendedTargets !== "number" ||
        Number(v.removedTargets) > v.intendedTargets)
    )
      fail("Removed targets require a called count and cannot exceed it.");
    if (a.tolerance === "assessed" && !v.tolerance)
      fail("Record the called tolerance before assessing it.");
    if (v.directionOverride && !String(v.directionReason ?? "").trim())
      fail("Explain the direction override.");
    if (
      v.conditionsAt &&
      !z.iso.datetime({ offset: true }).safeParse(v.conditionsAt).success
    )
      fail("Enter an ISO conditions timestamp with timezone.");
    if (
      v.conditionsChanged === "new_ice_segment" &&
      (!v.iceSegment || !v.conditionsNote || !v.conditionsAt)
    )
      fail("A new ice segment needs its name, note and time.");
    for (const key of ["earlierShotId", "followUpShotId"])
      if (v[key] && !z.uuid().safeParse(v[key]).success)
        fail("Choose a valid existing shot reference.");
    if (
      v.adjustmentDecision &&
      (!v.earlierShotId || !String(v.instruction ?? "").trim())
    )
      fail("A recorded decision needs an earlier shot and its instruction.");
    if (
      v.adjustmentDecision === "adjustment_made" &&
      !(v.adjustmentTypes as string[] | undefined)?.length
    )
      fail("Record what changed.");
    if (
      (v.adjustmentTypes as string[] | undefined)?.includes(
        "other_recorded_change",
      ) &&
      !String(v.adjustmentOther ?? "").trim()
    )
      fail("Describe the other recorded change.");
    if (v.followUpShotId && v.followUpRule)
      fail("Choose an explicit follow-up or a selection rule, not both.");
  });
export type Supplement = z.infer<typeof supplementSchema>;
export const emptySupplement = (): Supplement => ({
  version: ENHANCED_VERSION,
  mappingVersion: ENHANCED_VERSION,
  definitionRevision: 0,
  contextRevision: 0,
  contextSnapshot: {},
  retrospective: true,
  values: {},
  assessments: {},
});
export function standardConflicts(s: Supplement, shot: Shot): string[] {
  const conflicts: string[] = [];
  for (const key of ["line", "release"] as const)
    if (s.assessments[key] === "assessed" && !shot[key]) conflicts.push(key);
  for (const key of ["line", "release", "technical"] as const)
    if (s.assessments[key] === "not_applicable" && shot[key])
      conflicts.push(key);
  const defs = [
    shot.deficiency,
    ...((s.values.additionalDeficiencies ?? []) as string[]),
  ];
  if (
    s.assessments.deficiency === "assessed" &&
    defs.includes("Make") &&
    defs.some((d) => d && d !== "Make")
  )
    conflicts.push("deficiency");
  if (
    s.assessments.deficiency === "assessed" &&
    defs.includes("Light") &&
    defs.includes("Heavy")
  )
    conflicts.push("deficiency");
  if (
    s.assessments.weight === "assessed" &&
    ((shot.deficiency === "Light" && s.values.observedWeight === "heavy") ||
      (shot.deficiency === "Heavy" && s.values.observedWeight === "light"))
  )
    conflicts.push("weight");
  return [...new Set(conflicts)];
}
export function suggestStandard(
  detail: string,
  shot: Shot,
  existing: boolean,
): Shot {
  return !existing && !shot.type
    ? { ...shot, type: detailMappings[detail] ?? null }
    : shot;
}
export function deliveryDirection(s: Supplement, end: number): string | null {
  if (s.values.directionOverride) return String(s.values.directionOverride);
  const first = s.contextSnapshot.firstDirection;
  if (!first) return null;
  return end % 2 ? String(first) : first === "a_to_b" ? "b_to_a" : "a_to_b";
}
export function validateShotReferences(
  s: Supplement,
  shotId: string,
  shots: (Shot & { id: string })[],
) {
  const slot = (shot: Shot) =>
    (shot.end - 1) * 8 +
    ["Lead", "Second", "Third", "Fourth"].indexOf(shot.position) * 2 +
    shot.stone;
  const source = shots.find((shot) => shot.id === shotId);
  if (!source) throw new Error("Source shot unavailable.");
  for (const key of ["earlierShotId", "followUpShotId"] as const)
    if (s.values[key]) {
      const target = shots.find((shot) => shot.id === s.values[key]);
      if (
        !target ||
        (key === "earlierShotId"
          ? slot(target) >= slot(source)
          : slot(target) <= slot(source))
      )
        throw new Error(
          "Adjustment references must point to an actual preceding or following shot in this game.",
        );
    }
}
/** One observation: explicit chips update their matching contact/roll control. */
export function selectMisses(s: Supplement, misses: string[]): Supplement {
  const next: Supplement = {
    ...s,
    values: { ...s.values, misses },
    assessments: { ...s.assessments, misses: "assessed" as const },
  };
  if (misses.length === 1) next.values.primaryMiss = misses[0];
  else if (!misses.includes(String(next.values.primaryMiss)))
    delete next.values.primaryMiss;
  const flash = misses.some((m) => m.startsWith("flash_")),
    wreck = misses.some((m) => m.startsWith("wreck_")),
    thick = misses.some((m) => m.startsWith("contact_too_"));
  if (flash || wreck || thick) {
    next.assessments.contact = "assessed";
    next.values.contactResult = flash
      ? "intended_first_contact_missed"
      : wreck
        ? "approach_interrupted_before_intended_contact"
        : "intended_first_contact_made";
  }
  for (const [m, r] of Object.entries({
    roll_too_far: "too_far",
    roll_not_far_enough: "not_far_enough",
    roll_wrong_direction: "wrong_direction",
    shooter_lost_when_intended_to_stay: "shooter_lost",
  }))
    if (misses.includes(m)) {
      next.assessments.roll = "assessed";
      next.values.rollResult = r;
    }
  return next;
}
export const defaultDefinitions = {
  guard1: "Long guard",
  guard2: "Middle guard",
  guard3: "Tight guard",
  weightTerms:
    "Called destinations; team-specific takeout speeds, no universal seconds",
  difficulty:
    "Routine: normal call; Demanding: reduced margin; Very demanding: exceptional precision",
  tolerance: "Wide / Normal / Tight: coach assessment of the called margin",
  endA: "End A",
  endB: "End B",
  namedPaths: "",
};
export const preferencesSchema = z
  .object({
    mode: z.enum(["standard", "enhanced"]),
    automaticReports: z.boolean(),
    definitions: z
      .object(
        Object.fromEntries(
          Object.keys(defaultDefinitions).map((k) => [
            k,
            z.string().trim().max(2000),
          ]),
        ) as { [K in keyof typeof defaultDefinitions]: z.ZodString },
      )
      .strict(),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  mode: "standard",
  automaticReports: true,
  definitions: defaultDefinitions,
};
export type EnhancedRecord<T = Supplement> = {
  revision: number;
  sourceRevision: number;
  value: T;
  at: string;
  conflicts?: string[];
};
export const enhancedWriteSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    supplement: supplementSchema,
  })
  .strict();
