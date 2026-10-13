"use client";
import { shotTypes, type Shot } from "@/lib/curlcoach/model";
import {
  detailMappings,
  label,
  missChoices,
  type Supplement,
} from "@/lib/curlcoach/enhanced-catalog";
import {
  selectEntryShot,
  replaceEntryMisses,
} from "@/lib/curlcoach/entry-selection";

export function ShotPicker({
  shot,
  value,
  editing,
  onChange,
}: {
  shot: Shot;
  value: Supplement;
  editing: boolean;
  onChange: (shot: Shot, supplement: Supplement) => void;
}) {
  const choice = value.values.detail
    ? `enhanced:${value.values.detail}`
    : shot.type
      ? `standard:${shot.type}`
      : "";
  return (
    <label>
      Shot
      <select
        aria-label="Shot"
        value={choice}
        onChange={(e) => {
          const next = selectEntryShot(shot, value, e.target.value, editing);
          onChange(next.shot, next.supplement);
        }}
      >
        <option value="">Not recorded</option>
        <optgroup label="Curling Canada">
          {shotTypes.map((type) => (
            <option key={type} value={`standard:${type}`}>
              {type}
            </option>
          ))}
        </optgroup>
        <optgroup label="Enhanced detail">
          {Object.keys(detailMappings).map((detail) => (
            <option key={detail} value={`enhanced:${detail}`}>
              {label(detail)}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

export function MissPicker({
  value,
  onChange,
}: {
  value: Supplement;
  onChange: (value: Supplement) => void;
}) {
  const misses = (value.values.misses ?? []) as string[];
  const primary = String(value.values.primaryMiss ?? misses[0] ?? "");
  const selected =
    primary ||
    (value.assessments.misses === "assessed"
      ? "none"
      : (value.assessments.misses ?? "not_assessed"));
  const additional = misses.filter((m) => m !== primary);
  return (
    <div className="enhanced-miss-rows">
      <label>
        Primary miss
        <select
          aria-label="Primary miss"
          value={selected}
          onChange={(e) => {
            const choice = e.target.value;
            if (["not_assessed", "not_applicable", "none"].includes(choice))
              onChange(
                replaceEntryMisses(
                  value,
                  [],
                  undefined,
                  choice === "none"
                    ? "assessed"
                    : (choice as "not_assessed" | "not_applicable"),
                ),
              );
            else
              onChange(
                replaceEntryMisses(
                  value,
                  [choice, ...additional.filter((m) => m !== choice)],
                  choice,
                ),
              );
          }}
        >
          <option value="not_assessed">Not assessed</option>
          <option value="none">No listed miss</option>
          <option value="not_applicable">Not applicable</option>
          {missChoices.map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </select>
      </label>
      {additional.map((m, i) => (
        <div className="enhanced-select-row" key={i}>
          <label>
            Additional miss {i + 1}
            <select
              aria-label={`Additional miss ${i + 1}`}
              value={m}
              onChange={(e) =>
                onChange(
                  replaceEntryMisses(
                    value,
                    misses.map((old) => (old === m ? e.target.value : old)),
                    primary,
                  ),
                )
              }
            >
              {missChoices
                .filter((option) => option === m || !misses.includes(option))
                .map((option) => (
                  <option key={option} value={option}>
                    {label(option)}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={`Remove additional miss ${i + 1}`}
            onClick={() =>
              onChange(
                replaceEntryMisses(
                  value,
                  misses.filter((old) => old !== m),
                  primary,
                ),
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      {primary && misses.length < missChoices.length && (
        <label>
          Add another miss
          <select
            aria-label="Add another miss"
            value=""
            onChange={(e) => {
              if (e.target.value)
                onChange(
                  replaceEntryMisses(
                    value,
                    [...misses, e.target.value],
                    primary,
                  ),
                );
            }}
          >
            <option value="">None</option>
            {missChoices
              .filter((m) => !misses.includes(m))
              .map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}
