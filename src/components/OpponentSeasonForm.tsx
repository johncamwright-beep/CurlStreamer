"use client";
import { useState } from "react";
import { eventLevels } from "@/lib/team-hierarchy";
import {
  opponentPositions,
  opponentRosterSchema,
  opponentSeasonSchema,
  type OpponentSeason,
} from "@/lib/opponent-seasons";
export function OpponentSeasonForm({
  opponentId,
  seasonId,
  seasonName,
  profile,
  onSaved,
  onCancel,
}: {
  opponentId: string;
  seasonId: string;
  seasonName: string;
  profile?: OpponentSeason;
  onSaved: (profile: OpponentSeason) => void;
  onCancel: () => void;
}) {
  const [roster, setRoster] = useState(
    profile?.roster ?? opponentRosterSchema.parse({}),
  );
  const [level, setLevel] = useState(profile?.level ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="w-full border-t border-slate-600 pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/opponent-seasons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              opponentId,
              seasonId,
              level: level || null,
              roster,
              expectedRevision: profile?.revision ?? 0,
            }),
          });
          const body = await response.json();
          if (!response.ok)
            throw Error(body.error ?? "Could not save opponent details.");
          onSaved(opponentSeasonSchema.parse(body.profile));
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not save opponent details.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <legend className="mb-3 font-bold">
          {profile ? "Edit" : "Create"} {seasonName} version
        </legend>
        <label>
          Competition level
          <select
            className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
          >
            <option value="">Not recorded</option>
            {eventLevels.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {opponentPositions.map((position) => (
            <label key={position}>
              {position[0].toUpperCase() + position.slice(1)}
              <input
                className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                value={roster[position]}
                maxLength={100}
                placeholder="Name, if known"
                onChange={(e) =>
                  setRoster({ ...roster, [position]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <p className="text-sm text-slate-300">
          Saved only for {seasonName}. Other seasons keep their own players and
          level.
        </p>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn" type="submit">
            {busy ? "Saving…" : "Save season details"}
          </button>
          <button className="btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
