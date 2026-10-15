"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  assessmentStates,
  captureError,
  catalogue,
  contextSchema,
  defaultPreferences,
  deliveryDirection,
  emptySupplement,
  groups,
  label,
  preferencesSchema,
  setupCatalogue,
  supplementSchema,
  type EnhancedRecord,
  type Field,
  type Preferences,
  type Supplement,
  type Values,
} from "@/lib/curlcoach/enhanced-catalog";

import { MissPicker } from "./EntryControls";
import { WeightEntry, ResultsEntry, DifficultyEntry } from "./SubtypeEntry";
import { shotSubtypes } from "@/lib/curlcoach/shot-subtypes";
import EntryOverlay from "./EntryOverlay";
import { AssessmentCoverage } from "./AssessmentCoverage";
import {
  changeObservation,
  resultRelevant,
} from "@/lib/curlcoach/result-entry";

import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";

import { gameShots, type CoachEvent } from "@/lib/curlcoach/event";

import {
  shotTypes,
  turns,
  executions,
  deficiencies,
  lines,
  releases,
  technicals,
  exclusions,
  reviews,
  type Shot,
} from "@/lib/curlcoach/model";

import { reviewLink } from "@/lib/curlcoach/review";

const Metrics = createContext({
  preferences: defaultPreferences,
  revision: 0,
  ready: false,
  error: "",
  scopeKey: "",
  reload: async () => {},
  save: async (value: Preferences) => {
    void value;
  },
});

export const useMetrics = () => useContext(Metrics);

export async function enhancedRequest(url: string, body?: unknown) {
  const response = await fetch(url, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(result.error ?? "Enhanced request failed.");

  return result;
}

export function MetricsProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<EnhancedRecord<Preferences>>({
    revision: 0,
    sourceRevision: 0,
    value: defaultPreferences,
    at: "",
  });

  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [scopeKey, setScope] = useState("");

  const pending = useRef<{ signature: string; requestId: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await enhancedRequest("/api/curlcoach/enhanced");

      const saved = data.documents.find(
        (d: EnhancedDocument) => d.kind === "preferences",
      );

      setRecord(
        saved
          ? { ...saved, value: preferencesSchema.parse(saved.value) }
          : {
              revision: 0,
              sourceRevision: 0,
              value: defaultPreferences,
              at: "",
            },
      );

      setScope(`${data.scope.organizationId}:${data.scope.actorUserId}`);
      setReady(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Options unavailable");
    }
  }, []);

  async function save(value: Preferences) {
    const signature = JSON.stringify({ value, revision: record.revision });

    if (pending.current?.signature !== signature)
      pending.current = { signature, requestId: crypto.randomUUID() };

    const result = await enhancedRequest("/api/curlcoach/enhanced", {
      write: {
        kind: "preferences",
        requestId: pending.current.requestId,
        expectedRevision: record.revision,
        sourceRevision: 0,
        value,
      },
    });

    setRecord({ ...result, value });
    pending.current = null;
  }

  return (
    <Metrics.Provider
      value={{
        preferences: record.value,
        revision: record.revision,
        ready,
        error,
        scopeKey,
        reload,
        save,
      }}
    >
      {children}
    </Metrics.Provider>
  );
}

export function ValueField({
  name,
  field,
  values,
  onChange,
  options,
  optionLabels,
}: {
  name: string;
  field: Field;
  values: Values;
  onChange: (values: Values) => void;
  options?: string[];
  optionLabels?: Record<string, string>;
}) {
  const value = values[name];

  function set(next: string | number | string[] | undefined) {
    const copy = { ...values };
    if (next === undefined) delete copy[name];
    else copy[name] = next;
    onChange(copy);
  }

  if (field.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="enhanced-multiple">
        {selected.map((choice, index) => (
          <div className="enhanced-select-row" key={index}>
            <label>
              {field.label} {index + 1}
              <select
                aria-label={`${field.label} ${index + 1}`}
                value={choice}
                onChange={(e) =>
                  set(
                    selected.map((v, i) => (i === index ? e.target.value : v)),
                  )
                }
              >
                {field
                  .choices!.filter((v) => v === choice || !selected.includes(v))
                  .map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={`Remove ${field.label.toLowerCase()} ${index + 1}`}
              onClick={() => set(selected.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <label>
          {selected.length ? `Add ${field.label.toLowerCase()}` : field.label}
          <select
            aria-label={field.label}
            value={Array.isArray(value) && !selected.length ? "none" : ""}
            onChange={(e) => {
              if (e.target.value === "none") set([]);
              else if (e.target.value) set([...selected, e.target.value]);
            }}
          >
            <option value="">
              {selected.length ? "Choose another" : "Not recorded"}
            </option>
            {!selected.length && <option value="none">None recorded</option>}
            {field
              .choices!.filter((v) => !selected.includes(v))
              .map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <label>
      {field.label}
      {field.choices ? (
        <select
          aria-label={field.label}
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value || undefined)}
        >
          <option value="">
            {name === "detail" ? "Not further classified" : "Not recorded"}
          </option>
          {name === "intendedWeight" ? (
            <>
              <optgroup label="Stopping location">
                {field.choices
                  .filter((choice) => !choice.includes("takeout"))
                  .map((choice) => (
                    <option value={choice} key={choice}>
                      {label(choice)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Takeout weight class">
                {field.choices
                  .filter((choice) => choice.includes("takeout"))
                  .map((choice) => (
                    <option value={choice} key={choice}>
                      {label(choice)}
                    </option>
                  ))}
              </optgroup>
            </>
          ) : (
            field.choices.map((choice) => (
              <option value={choice} key={choice}>
                {optionLabels?.[choice] ?? label(choice)}
              </option>
            ))
          )}
        </select>
      ) : (
        <>
          <input
            aria-label={field.label}
            type={field.number ? "number" : "text"}
            min={field.number ? 0 : undefined}
            max={field.number ? field.max : undefined}
            maxLength={field.number ? undefined : field.max}
            list={options?.length ? `enhanced-${name}` : undefined}
            value={String(value ?? "")}
            onChange={(e) =>
              set(
                e.target.value === ""
                  ? undefined
                  : field.number
                    ? Number(e.target.value)
                    : e.target.value,
              )
            }
          />
          {options?.length ? (
            <datalist id={`enhanced-${name}`}>
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </label>
  );
}

export function EnhancedFields({
  value,
  onChange,
  section = "review",
  paths = [],
  shots = [],
  source,
}: {
  value: Supplement;
  onChange: (s: Supplement) => void;
  section?: "detail" | "call" | "miss" | "result" | "review" | "otherDetail";
  paths?: string[];
  shots?: (Shot & { id: string })[];
  source?: Shot;
}) {
  const selected =
    section === "detail"
      ? ["detail", "detailOther"]
      : section === "otherDetail"
        ? ["detailOther"]
        : section === "call"
          ? [
              "intendedWeight",
              "contactPlan",
              "guardToClear",
              "intendedRoll",
              "intendedTargets",
              "intendedRelease",
              "difficulty",
              "broadPath",
            ]
          : section === "miss"
            ? ["misses", "missOther"]
            : section === "result"
              ? ["observedWeight"]
              : Object.keys(catalogue).filter(
                  (k) => catalogue[k].location === "Review",
                );
  const relevantGroups = section === "review" ? [...groups] : [];

  function valuesChanged(values: Values, key: string) {
    onChange(changeObservation(value, key, values[key]));
  }

  function assessment(group: (typeof groups)[number]) {
    return (
      <label key={group}>
        {label(group)} assessment
        <select
          aria-label={`${label(group)} assessment`}
          value={value.assessments[group] ?? "not_assessed"}
          onChange={(e) => {
            const state = e.target.value as (typeof assessmentStates)[number];

            const next = {
              ...value,
              assessments: { ...value.assessments, [group]: state },
              values: { ...value.values },
            };

            if (state !== "assessed")
              for (const [k, f] of Object.entries(catalogue))
                if (f.group === group) delete next.values[k];

            if (group === "misses" && state !== "assessed")
              delete next.values.primaryMiss;

            onChange(next);
          }}
        >
          {assessmentStates.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderField(key: string) {
    const condition: Record<string, boolean> = {
      detailOther: value.values.detail === "other_detail",
      weightBasisOther: value.values.weightBasis === "other_recorded_basis",

      rollOther: value.values.rollResult === "other_recorded_result",
      missOther:
        (value.values.misses as string[] | undefined)?.includes(
          "other_observable_miss",
        ) ?? false,

      adjustmentOther:
        (value.values.adjustmentTypes as string[] | undefined)?.includes(
          "other_recorded_change",
        ) ?? false,

      directionReason: !!value.values.directionOverride,
    };

    if (condition[key] === false) return null;

    const slot = (shot: Shot) =>
      (shot.end - 1) * 8 +
      ["Lead", "Second", "Third", "Fourth"].indexOf(shot.position) * 2 +
      shot.stone;

    const reference = key === "earlierShotId" || key === "followUpShotId";

    const available = source
      ? shots.filter((s) =>
          key === "earlierShotId"
            ? slot(s) < slot(source)
            : slot(s) > slot(source),
        )
      : [];

    const optionLabels = Object.fromEntries(
      available.map((s) => [
        s.id,
        `End ${s.end} · ${s.position} · Rock ${s.stone} · ${s.type ?? "Unclassified"}`,
      ]),
    );

    const choices = available.map((s) => s.id);

    if (
      reference &&
      value.values[key] &&
      !choices.includes(String(value.values[key]))
    ) {
      choices.push(String(value.values[key]));
      optionLabels[String(value.values[key])] =
        "Unavailable reference — choose another shot";
    }

    const control = (
      <ValueField
        name={key}
        field={reference ? { ...catalogue[key], choices } : catalogue[key]}
        optionLabels={optionLabels}
        values={value.values}
        options={key === "namedPath" ? paths : undefined}
        onChange={(values) => valuesChanged(values, key)}
      />
    );

    if (key === "misses")
      return <MissPicker key={key} value={value} onChange={onChange} />;
    if (
      [
        "observedWeight",
        "contactResult",
        "rollResult",
        "toleranceResult",
      ].includes(key)
    ) {
      const group = catalogue[key].group as (typeof groups)[number];
      return (
        <label key={key}>
          {catalogue[key].label}
          <select
            aria-label={catalogue[key].label}
            value={String(
              value.values[key] ?? value.assessments[group] ?? "not_assessed",
            )}
            onChange={(e) => {
              const choice = e.target.value;
              const cleared =
                choice === "not_assessed" || choice === "not_applicable";
              const next = changeObservation(
                value,
                key,
                cleared ? undefined : choice,
              );
              if (cleared) next.assessments[group] = choice;
              onChange(next);
            }}
          >
            <option value="not_assessed">Not assessed</option>
            <option value="not_applicable">Not applicable</option>
            {catalogue[key].choices!.map((choice) => (
              <option key={choice} value={choice}>
                {label(choice)}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return <div key={key}>{control}</div>;
  }

  const detailResults = [
    "contactResult",
    "rollResult",
    "rollOther",
    "removedTargets",
  ];
  if (section === "call")
    return (
      <div className="enhanced-fields">
        {renderField("intendedWeight")}
        {renderField("guardToClear")}
        <EntryOverlay
          className="enhanced-call-details"
          title="Optional call details"
          description="Contact plan, roll, targets and release."
        >
          <div className="enhanced-fields">
            {selected
              .filter((k) => k !== "intendedWeight" && k !== "guardToClear")
              .map(renderField)}
          </div>
        </EntryOverlay>
      </div>
    );
  if (section === "result")
    return (
      <>
        {renderField("observedWeight")}
        {detailResults.some((key) => resultRelevant(value.values, key)) && (
          <EntryOverlay
            className="enhanced-result-details"
            title="More details"
            description="First contact, roll and target stones removed."
          >
            <div className="enhanced-fields">
              {detailResults
                .filter((key) => resultRelevant(value.values, key))
                .map(renderField)}
            </div>
          </EntryOverlay>
        )}
      </>
    );

  if (section === "review") {
    const sections: {
      title: string;
      fields: string[];
      assessments?: (typeof groups)[number][];
    }[] = [
      {
        title: "Historical call and observations",
        fields: [
          "detail",
          "detailOther",
          "contactPlan",
          "guardToClear",
          "intendedRoll",
          "intendedTargets",
          "intendedRelease",
          "broadPath",
          "observedWeight",
          "misses",
          "missOther",
        ],
      },
      {
        title: "Weight basis and historical result details",
        fields: [
          "weightBasis",
          "weightBasisOther",
          "tolerance",
          "toleranceResult",
          ...detailResults,
        ],
      },

      {
        title: "Delivery and deficiency assessments",
        fields: ["additionalTechnical", "additionalDeficiencies"],
        assessments: ["line", "release", "technical", "deficiency"],
      },

      {
        title: "Ice path, conditions and provenance",
        fields: [
          "namedPath",
          "directionOverride",
          "directionReason",
          "iceSegment",
          "conditionsChanged",
          "conditionsNote",
          "conditionsAt",
          "source",
          "sourceReconciliation",
        ],
      },

      {
        title: "Recorded adjustment and follow-up",
        fields: [
          "earlierShotId",
          "adjustmentDecision",
          "adjustmentTypes",
          "adjustmentOther",
          "instruction",
          "followUpShotId",
          "followUpRule",
          "visibility",
        ],
      },
    ];

    return (
      <div className="enhanced-review-sections">
        {sections.map((s) => (
          <details key={s.title}>
            <summary>{s.title}</summary>
            <div className="enhanced-fields">
              {s.assessments?.map(assessment)}
              {s.fields.map(renderField)}
            </div>
          </details>
        ))}
      </div>
    );
  }

  return (
    <div className="enhanced-fields">
      {relevantGroups.map(assessment)}
      {selected.map(renderField)}
    </div>
  );
}

export function MetricsOptions() {
  const metrics = useMetrics();

  const [draft, setDraft] = useState(metrics.preferences),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => setDraft(metrics.preferences), [metrics.preferences]);

  return (
    <section className="event-card enhanced">
      <h2>Shot tracking metrics</h2>
      <p>
        Your private setting follows you across games, events, seasons and
        devices. Standard history and exports are unchanged.
      </p>
      {metrics.error && <p role="alert">{metrics.error}</p>}
      <button type="button" onClick={() => void metrics.reload()}>
        Reload Options
      </button>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await metrics.save(preferencesSchema.parse(draft));
            setMessage("Options saved for your coaching account.");
          } catch (error) {
            setMessage(captureError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Metrics mode
          <select
            value={draft.mode}
            onChange={(e) =>
              setDraft({
                ...draft,
                mode: e.target.value as Preferences["mode"],
              })
            }
          >
            <option value="standard">Standard Curl Canada</option>
            <option value="enhanced">Enhanced Metrics</option>
          </select>
        </label>

        <label>
          Automatic season reports
          <select
            value={draft.automaticReports ? "on" : "off"}
            onChange={(e) =>
              setDraft({ ...draft, automaticReports: e.target.value === "on" })
            }
          >
            <option value="on">
              On when Enhanced, AI and allowance are enabled
            </option>
            <option value="off">Off</option>
          </select>
        </label>
        <p>
          Season report generation arrives in a later phase. This setting makes
          no AI calls and sends no reports. Existing event reports retain their
          current allowance.
        </p>

        <details>
          <summary>Versioned team call definitions</summary>
          <p>
            Changing definitions creates a new version. Previously recorded
            shots keep their original definition reference. Directions are
            viewed from the hack.
          </p>
          {Object.entries(draft.definitions).map(([key, value]) => (
            <label key={key}>
              {label(key.replace(/([A-Z])/g, "_$1").toLowerCase())}
              <textarea
                value={value}
                maxLength={2000}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    definitions: {
                      ...draft.definitions,
                      [key]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
        </details>

        <button disabled={busy || !metrics.ready}>Save Options</button>
        <p role="status">{message}</p>
      </form>

      <details>
        <summary>Standard Curl Canada reference</summary>
        {Object.entries({
          "Shot type": shotTypes,
          Turn: turns,
          Execution: executions,
          Deficiency: deficiencies,
          Line: lines,
          Release: releases,
          Technical: technicals,
          Exclusion: exclusions,
          "Review category": reviews,
        }).map(([name, choices]) => (
          <article key={name}>
            <h3>{name} · Live / Review</h3>
            <p>{choices.join(" · ")} · Not recorded</p>
            <p>
              Example: {choices[0]}. Existing Standard values and calculations
              are preserved.
            </p>
          </article>
        ))}
        <p>
          Numeric grade: 0–5 or not graded, independent of execution. Player and
          lineup identify each end (1–20) and first/second stone. Notes allow
          1,000 characters. Flags, video timestamps, look-back and delay keep
          their existing meaning.
        </p>
      </details>
      <details>
        <summary>Field catalogue · enhanced-v1</summary>
        <p>
          Blank means unknown. Outcome and numeric grade remain independent.
          Existing Line, Release and Technical controls remain available in
          Standard mode.
        </p>
        {Object.entries({ ...catalogue, ...setupCatalogue }).map(
          ([key, field]) => (
            <article key={key}>
              <h3>
                {field.label} · {field.location}
              </h3>
              <p>{field.meaning}</p>
              <p>
                {field.choices?.map(label).join(" · ") ??
                  (field.number
                    ? `0–${field.max}, or not recorded`
                    : `Optional text, up to ${field.max} characters`)}
                {field.group
                  ? " · Not assessed / Assessed / Not applicable"
                  : ""}
              </p>
              <p>Example: {label(field.example)}</p>
            </article>
          ),
        )}
      </details>
    </section>
  );
}

export function useEnhancedGame(
  gameId?: string,
  eventId?: string,
  enabled = true,
) {
  const [documents, setDocuments] = useState<EnhancedDocument[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (!gameId || !enabled) return;
    const current = ++generation.current;
    setReady(false);

    try {
      const data = await enhancedRequest(
        `/api/curlcoach/enhanced?gameId=${encodeURIComponent(gameId)}&eventId=${encodeURIComponent(eventId ?? "practice")}`,
      );
      if (current !== generation.current) return;
      setDocuments(data.documents);
      setReady(true);
      setError("");
    } catch (e) {
      if (current !== generation.current) return;
      setError(
        e instanceof Error ? e.message : "Enhanced observations unavailable.",
      );
    }
  }, [gameId, eventId, enabled]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);

  return { documents, ready, error, reload, setDocuments };
}

export function GameContext({
  gameId,
  eventId,
  documents,
  onSaved,
}: {
  gameId: string;
  eventId: string;
  documents: EnhancedDocument[];
  onSaved: () => Promise<void>;
}) {
  const metrics = useMetrics(),
    record = documents.find((d) => d.kind === "context");

  const [draft, setDraft] = useState<Values>(
    () =>
      (record?.value as Values) ?? {
        purpose: "competition",
        endA: metrics.preferences.definitions.endA,
        endB: metrics.preferences.definitions.endB,
      },
  );

  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    if (record) setDraft(record.value as Values);
  }, [record]);

  const pending = useRef<{ signature: string; requestId: string } | null>(null);

  return (
    <details className="enhanced">
      <summary>Game context · optional</summary>
      <div className="enhanced-fields">
        {Object.entries(setupCatalogue).map(([key, field]) => (
          <ValueField
            key={key}
            name={key}
            field={field}
            values={draft}
            onChange={setDraft}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const signature = JSON.stringify({
              draft,
              revision: record?.revision ?? 0,
            });

            if (pending.current?.signature !== signature)
              pending.current = { signature, requestId: crypto.randomUUID() };

            await enhancedRequest("/api/curlcoach/enhanced", {
              gameId,
              eventId,
              write: {
                kind: "context",
                requestId: pending.current.requestId,
                expectedRevision: record?.revision ?? 0,
                sourceRevision: 0,
                value: contextSchema.parse(draft),
              },
            });

            pending.current = null;
            await onSaved();
            setMessage("Game context saved.");
          } catch (e) {
            setMessage(captureError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save game context
      </button>
      <p role="status">{message}</p>
    </details>
  );
}

export function EnhancedReview({ event }: { event: CoachEvent }) {
  const metrics = useMetrics();

  const [gameId, setGame] = useState(event.games[0]?.id ?? ""),
    [shotId, setShot] = useState("");

  const game = event.games.find((g) => g.id === gameId),
    shots = game ? gameShots(game) : [];

  const data = useEnhancedGame(gameId, event.id);

  const selected = shots.find((s) => s.id === shotId);

  const record = data.documents.find(
    (d) => d.kind === "supplement" && d.shotId === shotId,
  );

  const [draft, setDraft] = useState(emptySupplement),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);

  const pending = useRef<{ signature: string; requestId: string } | null>(null);

  const contextRecord = data.documents.find((d) => d.kind === "context");

  useEffect(() => {
    const next = record
      ? supplementSchema.parse(record.value)
      : {
          ...emptySupplement(),
          definitionRevision: metrics.revision,
          contextRevision: contextRecord?.revision ?? 0,
          contextSnapshot: (contextRecord?.value as Values) ?? {},
        };

    if (!next.values.source || next.values.source === "live_entry")
      next.values.source = "coach_retrospective_review";

    setDraft(next);
  }, [shotId, record, contextRecord, metrics.revision]);

  if (metrics.preferences.mode !== "enhanced")
    return (
      <p>
        Choose Enhanced Metrics in Options to review supplemental observations.
        Existing data is retained.
      </p>
    );

  return (
    <section className="event-card enhanced">
      <h2>Enhanced shot review</h2>
      <p>
        Review observations without reopening scores. Standard corrections still
        require the game’s audited reopen workflow.
      </p>
      <label>
        Review game
        <select
          value={gameId}
          onChange={(e) => {
            setGame(e.target.value);
            setShot("");
          }}
        >
          {event.games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} · {g.opponent}
            </option>
          ))}
        </select>
      </label>
      <label>
        Review shot
        <select value={shotId} onChange={(e) => setShot(e.target.value)}>
          <option value="">Choose a recorded shot</option>
          {shots.map((s) => (
            <option key={s.id} value={s.id}>
              End {s.end} ·{" "}
              {game?.state.roster?.find((p) => p.id === s.playerId)?.name ??
                s.position}{" "}
              · Rock {s.stone} · {s.type ?? "Unclassified"}
            </option>
          ))}
        </select>
      </label>

      {data.error && <p role="alert">{data.error}</p>}
      <button type="button" onClick={() => void data.reload()}>
        Reload review
      </button>

      {data.ready && game && (
        <GameContext
          gameId={gameId}
          eventId={event.id}
          documents={data.documents}
          onSaved={data.reload}
        />
      )}

      {data.ready && (
        <AssessmentCoverage shots={shots} documents={data.documents} />
      )}

      {selected && data.ready && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const value = supplementSchema.parse({
                ...draft,
                values: {
                  ...draft.values,
                  source: draft.values.source ?? "coach_retrospective_review",
                },
              });

              const sourceRevision = game!.state.events
                .filter((e) => e.shotId === shotId)
                .at(-1)!.revision;

              const payload = {
                kind: "supplement",
                expectedRevision: record?.revision ?? 0,
                sourceRevision,
                shotId,
                value,
              };

              const signature = JSON.stringify(payload);
              if (pending.current?.signature !== signature)
                pending.current = { signature, requestId: crypto.randomUUID() };

              await enhancedRequest("/api/curlcoach/enhanced", {
                gameId,
                eventId: event.id,
                write: { ...payload, requestId: pending.current.requestId },
              });
              pending.current = null;

              await data.reload();
              setMessage(
                "Enhanced review saved. Standard scores are unchanged.",
              );
            } catch (e) {
              setMessage(captureError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Standard: {selected.execution ?? "Not recorded"} · Grade{" "}
            {selected.grade ?? "Not graded"} ·{" "}
            {selected.deficiency ?? "No deficiency recorded"}
          </p>
          <p>
            Line: {selected.line ?? "Not recorded"} · Release:{" "}
            {selected.release ?? "Not recorded"} · Technical:{" "}
            {selected.technical ?? "Not recorded"}
          </p>
          <p>{selected.note}</p>
          {reviewLink(selected.videoReview) && (
            <a
              target="_blank"
              rel="noreferrer"
              href={reviewLink(selected.videoReview)!}
            >
              Review video
            </a>
          )}

          <p>
            Delivery direction:{" "}
            {label(deliveryDirection(draft, selected.end) ?? "unknown")} ·
            Context version {draft.contextRevision}. Changes made here are
            recorded as retrospective review.
          </p>

          {contextRecord &&
            contextRecord.revision !== draft.contextRevision && (
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    contextRevision: contextRecord.revision,
                    contextSnapshot: contextRecord.value as Values,
                  })
                }
              >
                Use current game context for this shot
              </button>
            )}

          {record && (
            <details>
              <summary>Saved observation details</summary>
              <dl>
                {Object.entries((record.value as Supplement).values).map(
                  ([key, v]) => (
                    <div key={key}>
                      <dt>{catalogue[key]?.label ?? label(key)}</dt>
                      <dd>
                        {Array.isArray(v)
                          ? v.length
                            ? v.map(label).join(", ")
                            : "Explicitly none recorded"
                          : typeof v === "string" && catalogue[key]?.choices
                            ? label(v)
                            : String(v)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
              <p>
                {Object.entries((record.value as Supplement).assessments)
                  .map(([key, v]) => `${label(key)}: ${label(v)}`)
                  .join(" · ")}
              </p>
            </details>
          )}

          {!!record?.conflicts?.length && (
            <p role="alert">
              Needs review: {record.conflicts.join(", ")}. These Enhanced
              observations are not eligible for rates until reconciled. Confirm
              against the current Standard record before saving.
            </p>
          )}

          <section className="coach-entry-section">
            <h3>Shot selection</h3>
            <p>Shot type: {selected.type ?? "Not recorded"}</p>
            <ValueField
              name="shotSubtype"
              field={{
                ...catalogue.shotSubtype,
                choices: shotSubtypes
                  .filter(
                    (s) =>
                      s.standard === selected.type ||
                      s.id === draft.values.shotSubtype,
                  )
                  .map((s) => s.id),
              }}
              values={draft.values}
              onChange={(values) =>
                setDraft(
                  changeObservation(draft, "shotSubtype", values.shotSubtype),
                )
              }
            />
            <WeightEntry
              shot={selected}
              value={draft}
              enhanced
              onChange={setDraft}
            />
            <DifficultyEntry value={draft} onChange={setDraft} />
          </section>
          <section className="coach-entry-section">
            <h3>Execution observations</h3>
            <WeightEntry
              observed
              shot={selected}
              value={draft}
              enhanced
              onChange={setDraft}
            />
            <ResultsEntry
              shot={selected}
              value={draft}
              enhanced
              onChange={setDraft}
            />
          </section>
          <EnhancedFields
            value={draft}
            onChange={setDraft}
            shots={shots}
            source={selected}
            paths={metrics.preferences.definitions.namedPaths
              .split("\n")
              .filter(Boolean)}
          />

          <button disabled={busy}>Save Enhanced review</button>
          <p role="status">{message}</p>
        </form>
      )}
    </section>
  );
}
