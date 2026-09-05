"use client";

import React, { useId, useState } from "react";

export const ROCK_COLOUR_PRESETS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#facc15" },
  { name: "Blue", value: "#2563eb" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Black", value: "#000000" },
  { name: "White", value: "#ffffff" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "Light blue", value: "#38bdf8" },
] as const;

const customFallback = "#64748b";

function validColour(value: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function RockColourSelector({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const id = useId();
  const initialValue = validColour(defaultValue, customFallback);
  const initialPreset = ROCK_COLOUR_PRESETS.find(
    (preset) => preset.value.toLowerCase() === initialValue.toLowerCase(),
  );
  const [value, setValue] = useState(initialValue);
  const [customValue, setCustomValue] = useState(
    initialPreset ? customFallback : initialValue,
  );
  const [mode, setMode] = useState<"preset" | "custom">(
    initialPreset ? "preset" : "custom",
  );
  const selectedPreset =
    mode === "preset"
      ? ROCK_COLOUR_PRESETS.find(
          (preset) => preset.value.toLowerCase() === value.toLowerCase(),
        )
      : undefined;
  const customSelected = mode === "custom";

  function chooseCustom(next: string) {
    const colour = validColour(next, customValue);
    setCustomValue(colour);
    setValue(colour);
    setMode("custom");
  }

  return (
    <fieldset className="min-w-0">
      <legend className="font-bold">{label}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
        {ROCK_COLOUR_PRESETS.map((preset) => {
          const selected = selectedPreset?.value === preset.value;
          return (
            <label
              key={preset.value}
              title={`${label}: ${preset.name}`}
              className={`relative min-h-11 min-w-11 rounded-lg border-2 ${
                selected
                  ? "border-cyan-300 ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900"
                  : "border-slate-500"
              }`}
              style={{
                backgroundColor: preset.value,
                boxShadow: "inset 0 0 0 1px rgb(15 23 42 / 0.65)",
              }}
            >
              <input
                type="radio"
                name={`${id}-choice`}
                value={preset.value}
                checked={selected}
                aria-label={`${label}: ${preset.name}`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={() => {
                  setMode("preset");
                  setValue(preset.value);
                }}
              />
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 grid place-items-center text-xl font-black text-slate-950 [text-shadow:_0_0_2px_white]"
                >
                  ✓
                </span>
              )}
            </label>
          );
        })}
        <label
          className={`col-span-2 min-h-11 rounded-lg border-2 px-3 font-bold ${
            customSelected
              ? "border-cyan-300 ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900"
              : "border-slate-500"
          } relative grid cursor-pointer place-items-center`}
        >
          <input
            type="radio"
            name={`${id}-choice`}
            value="custom"
            checked={customSelected}
            aria-label={`${label}: Custom`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={() => {
              setMode("custom");
              setValue(customValue);
            }}
          />
          Custom
        </label>
      </div>
      {customSelected && (
        <label className="mt-3 flex min-h-11 items-center gap-3 rounded-lg bg-slate-800 px-3">
          <span className="shrink-0">Custom colour</span>
          <input
            id={`${id}-custom`}
            type="color"
            value={customValue}
            aria-label={`${label} custom colour`}
            className="min-h-11 min-w-14 flex-1 bg-transparent"
            onChange={(event) => chooseCustom(event.target.value)}
          />
          <span className="font-mono text-sm uppercase">{customValue}</span>
        </label>
      )}
      <p className="mt-2 text-sm text-slate-300" aria-live="polite">
        Selected: {selectedPreset?.name ?? `Custom ${value.toUpperCase()}`}
      </p>
    </fieldset>
  );
}
