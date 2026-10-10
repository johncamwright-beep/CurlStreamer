"use client";
import React, { useState } from "react";
import { RockColourSelector } from "./RockColourSelector";

export function InGameRockColours({
  homeName,
  awayName,
  homeColor,
  awayColor,
  disabled,
  save,
}: {
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  disabled: boolean;
  save: (action: {
    type: "rock-colours";
    homeColor: string;
    awayColor: string;
  }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <button
        className="btn-secondary"
        disabled={disabled || busy}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setError("");
        }}
      >
        Rock colours
      </button>
      {open && (
        <form
          className="mt-3 rounded-xl border border-slate-600 bg-slate-900 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || disabled) return;
            const values = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            try {
              await save({
                type: "rock-colours",
                homeColor: String(values.get("homeColor")),
                awayColor: String(values.get("awayColor")),
              });
              setOpen(false);
            } catch {
              setError("Could not save rock colours. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy || disabled} className="space-y-4">
            <RockColourSelector
              name="homeColor"
              label={homeName + " rocks"}
              defaultValue={homeColor}
            />
            <RockColourSelector
              name="awayColor"
              label={awayName + " rocks"}
              defaultValue={awayColor}
            />
            <button className="btn" type="submit">
              {busy ? "Saving…" : "Save rock colours"}
            </button>
          </fieldset>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
