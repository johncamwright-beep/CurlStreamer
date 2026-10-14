"use client";

import { shotTypes, type Shot } from "@/lib/curlcoach/model";
import {
  catalogue,
  label,
  type Supplement,
} from "@/lib/curlcoach/enhanced-catalog";
import { changeObservation } from "@/lib/curlcoach/result-entry";
import {
  entryChoices,
  shotSubtypes,
  weightLabels,
  resultLabels,
} from "@/lib/curlcoach/shot-subtypes";

type Props = {
  shot: Shot;
  value: Supplement;
  enhanced: boolean;
  onChange: (value: Supplement) => void;
};

/** Keep out-of-list saved values visible and clearable, without offering them as new choices. */
function Choice({
  title,
  value,
  choices,
  labels = {},
  onChange,
  blank = "Not recorded",
}: {
  title: string;
  value?: string;
  choices: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
  blank?: string;
}) {
  return (
    <label>
      {title}
      <select
        aria-label={title}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{blank}</option>
        {value && !choices.includes(value) && (
          <option value={value} disabled>
            {labels[value] ?? label(value)} (previous selection)
          </option>
        )}
        {choices.map((c) => (
          <option key={c} value={c}>
            {labels[c] ?? label(c)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ShotTypeEntry({
  shot,
  value,
  enhanced,
  onChange,
  onShot,
}: Props & { onShot: (shot: Shot) => void }) {
  return (
    <>
      <Choice
        title="Shot type"
        value={shot.type ?? ""}
        choices={[...shotTypes]}
        labels={Object.fromEntries(shotTypes.map((t) => [t, t]))}
        onChange={(type) => {
          onShot({ ...shot, type: (type || null) as Shot["type"] });
          // Only an explicit change of parent clears its subtype. Other observations remain intact.
          if (type !== shot.type && value.values.shotSubtype)
            onChange(changeObservation(value, "shotSubtype", undefined));
        }}
      />
      {enhanced && (
        <Choice
          title="Shot subtype"
          value={String(value.values.shotSubtype ?? "")}
          choices={shotSubtypes
            .filter((s) => s.standard === shot.type)
            .map((s) => s.id)}
          labels={Object.fromEntries(shotSubtypes.map((s) => [s.id, s.name]))}
          onChange={(id) =>
            onChange(changeObservation(value, "shotSubtype", id || undefined))
          }
        />
      )}
    </>
  );
}

export function WeightEntry({
  shot,
  value,
  enhanced,
  onChange,
  observed = false,
}: Props & { observed?: boolean }) {
  const key = observed ? "observedDestination" : "intendedWeight";
  return (
    <Choice
      title={observed ? "Observed weight" : "Called weight"}
      blank={observed ? "Not assessed" : "Not recorded"}
      value={String(value.values[key] ?? "")}
      choices={
        entryChoices(shot.type, value.values.shotSubtype, enhanced).weights
      }
      labels={weightLabels}
      onChange={(choice) =>
        onChange(changeObservation(value, key, choice || undefined))
      }
    />
  );
}

export function DifficultyEntry({
  value,
  onChange,
}: Pick<Props, "value" | "onChange">) {
  return (
    <Choice
      title="Shot difficulty"
      value={String(value.values.difficulty ?? "")}
      choices={[...catalogue.difficulty.choices!]}
      onChange={(choice) =>
        onChange(changeObservation(value, "difficulty", choice || undefined))
      }
    />
  );
}

export function ResultsEntry({ shot, value, enhanced, onChange }: Props) {
  const choices = entryChoices(
    shot.type,
    value.values.shotSubtype,
    enhanced,
  ).results;
  const selected = (value.values.resultObservations ?? []) as string[];
  const primary =
    selected[0] ?? (value.assessments.results === "assessed" ? "none" : "");
  const set = (results: string[] | undefined) =>
    onChange(changeObservation(value, "resultObservations", results));
  return (
    <div className="enhanced-miss-rows">
      <Choice
        title="Result observations"
        blank="Not assessed"
        value={primary}
        choices={["none", ...choices]}
        labels={{ ...resultLabels, none: "No observed miss" }}
        onChange={(result) =>
          set(
            !result
              ? undefined
              : result === "none"
                ? []
                : [result, ...selected.slice(1).filter((r) => r !== result)],
          )
        }
      />
      {selected.slice(1).map((result, index) => (
        <div className="enhanced-select-row" key={index}>
          <Choice
            title={`Additional miss ${index + 1}`}
            value={result}
            choices={choices.filter(
              (r) => r === result || !selected.includes(r),
            )}
            labels={resultLabels}
            onChange={(next) =>
              set(
                selected.flatMap((r, i) =>
                  i === index + 1 ? (next ? [next] : []) : [r],
                ),
              )
            }
          />
          <button
            type="button"
            aria-label={`Remove additional miss ${index + 1}`}
            onClick={() => set(selected.filter((_, i) => i !== index + 1))}
          >
            Remove
          </button>
        </div>
      ))}
      {selected.length > 0 && (
        <Choice
          title="Add another miss"
          value=""
          choices={choices.filter((r) => !selected.includes(r))}
          labels={resultLabels}
          blank="Choose another"
          onChange={(next) => {
            if (next) set([...selected, next]);
          }}
        />
      )}
    </div>
  );
}
