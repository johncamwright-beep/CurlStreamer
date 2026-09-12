"use client";
import { AccomplishmentYearSelect } from "./AccomplishmentYearSelect";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_TIMEZONE, TimezoneSelect } from "./TimezoneSelect";

const CREATE_NEW = "__create-new__";

export type OnboardingSeason = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "draft" | "active" | "archived";
};

export type OnboardingEvent = {
  id: string;
  seasonId: string;
  name: string;
  eventType: string;
  startDate: string;
  endDate: string;
  location: string | null;
  level?: string | null;
  archivedAt: string | null;
};

type SavedSelection = { seasonId?: string; eventId?: string };

export function OnboardingSeasonEvent({
  step,
  onSaved,
  seasonId,
  eventId,
  seasons = [],
  events = [],
}: {
  step: "season" | "event";
  onSaved: (data: SavedSelection) => void;
  seasonId?: string;
  eventId?: string;
  /** Pass the authorized server-loaded hierarchy data from the wizard. */
  seasons?: readonly OnboardingSeason[];
  /** Pass the authorized server-loaded hierarchy data from the wizard. */
  events?: readonly OnboardingEvent[];
}) {
  const availableSeasons = useMemo(
    () => seasons.filter((season) => season.status !== "archived"),
    [seasons],
  );
  const availableEvents = useMemo(
    () =>
      events.filter(
        (event) => event.seasonId === seasonId && event.archivedAt === null,
      ),
    [events, seasonId],
  );
  const [createdSeason, setCreatedSeason] = useState<OnboardingSeason | null>(
    null,
  );
  const selectableSeasons = useMemo(
    () =>
      createdSeason &&
      !availableSeasons.some((season) => season.id === createdSeason.id)
        ? [...availableSeasons, createdSeason]
        : availableSeasons,
    [availableSeasons, createdSeason],
  );
  const initialSelection =
    step === "season"
      ? selectableSeasons.some((season) => season.id === seasonId)
        ? seasonId!
        : CREATE_NEW
      : availableEvents.some((event) => event.id === eventId)
        ? eventId!
        : CREATE_NEW;
  const [selection, setSelection] = useState(initialSelection);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSeason = step === "season";
  const options = isSeason ? selectableSeasons : availableEvents;
  const selectionLabel = isSeason ? "Choose season" : "Choose event";

  useEffect(() => {
    setSelection(initialSelection);
  }, [initialSelection]);

  async function activateSeason(id: string, newlyCreated = false) {
    try {
      const response = await fetch("/api/team-schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "activateSeason", seasonId: id }),
      });
      if (response.ok) return true;
      const body = await response.json().catch(() => null);
      setError(
        body?.error ??
          (newlyCreated
            ? "The season was created, but could not be made current. Retry or clear the current-season option to continue with it."
            : "The season could not be made current. Retry or clear the current-season option to continue with it."),
      );
    } catch {
      setError(
        newlyCreated
          ? "The season was created, but could not be made current. Retry or clear the current-season option to continue with it."
          : "The season could not be made current. Retry or clear the current-season option to continue with it.",
      );
    }
    return false;
  }

  async function chooseExisting() {
    if (selection === CREATE_NEW) return;
    setBusy(true);
    setError("");
    try {
      if (isSeason) {
        const selected = selectableSeasons.find(
          (season) => season.id === selection,
        );
        if (
          makeCurrent &&
          selected?.status !== "active" &&
          !(await activateSeason(selection, selection === createdSeason?.id))
        )
          return;
        onSaved({ seasonId: selection });
        return;
      }
      onSaved({ seasonId, eventId: selection });
    } finally {
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSeason && !seasonId) {
      setError("Choose a season before creating an event.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const input = isSeason
      ? {
          name: form.get("name"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
        }
      : {
          seasonId,
          name: form.get("name"),
          eventType: form.get("eventType"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
          location: form.get("location") || undefined,
          result: form.get("result") || null,
          accomplishmentYear: Number(form.get("accomplishmentYear")),
          level: form.get("level") || null,
          showLevel: form.get("showLevel") === "on",
          timezone,
        };
    try {
      const response = await fetch("/api/team-schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: isSeason ? "createSeason" : "createEvent",
          input,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "The details could not be saved.");
        return;
      }
      const id = createdId(body);
      if (!id) {
        setError(
          "The details were saved, but the new record could not be selected.",
        );
        return;
      }
      if (isSeason) {
        const season = {
          id,
          name: String(input.name),
          startDate: String(input.startDate),
          endDate: String(input.endDate),
          status: "draft" as const,
        };
        setCreatedSeason(season);
        setSelection(id);
        if (makeCurrent && !(await activateSeason(id, true))) return;
        if (makeCurrent) setCreatedSeason({ ...season, status: "active" });
        onSaved({ seasonId: id });
        return;
      }
      onSaved({ seasonId, eventId: id });
    } catch {
      setError(
        "The details could not be saved. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel grid gap-4"
      aria-labelledby={`${step}-step-title`}
    >
      <div>
        <h2 id={`${step}-step-title`} className="text-2xl font-bold">
          {isSeason ? "Choose a season" : "Choose an event"}
        </h2>
        <p className="text-slate-300">
          {isSeason
            ? "Select an existing season or create one for this schedule."
            : "Select an existing event or create one for this season."}
        </p>
      </div>

      {!isSeason && !seasonId ? (
        <p role="alert" className="text-red-300">
          Choose a season before setting up an event.
        </p>
      ) : (
        <>
          <label>
            {selectionLabel}
            <select
              aria-label={selectionLabel}
              value={selection}
              onChange={(event) => {
                setSelection(event.target.value);
                setError("");
              }}
              disabled={busy}
              className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
            >
              <option value={CREATE_NEW}>
                {isSeason ? "Create a new season" : "Create a new event"}
              </option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {isSeason ? ` (${item.startDate} – ${item.endDate})` : ""}
                </option>
              ))}
            </select>
          </label>

          {isSeason && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={makeCurrent}
                onChange={(event) => setMakeCurrent(event.target.checked)}
                className="h-5 w-5"
              />
              Make this the current season
            </label>
          )}

          {selection === CREATE_NEW ? (
            <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
              <label className={isSeason ? "sm:col-span-2" : ""}>
                {isSeason ? "Season name" : "Event name"}
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder={
                    isSeason ? suggestedSeasonName() : "Club championship"
                  }
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              {!isSeason && (
                <EventFields timezone={timezone} setTimezone={setTimezone} />
              )}
              <label>
                Start date
                <input
                  name="startDate"
                  type="date"
                  required
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              <label>
                End date
                <input
                  name="endDate"
                  type="date"
                  required
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              <button disabled={busy} className="btn min-h-11 sm:col-span-2">
                {busy ? "Saving…" : isSeason ? "Create season" : "Create event"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={chooseExisting}
              disabled={busy}
              className="btn min-h-11"
            >
              {isSeason && makeCurrent && selection === createdSeason?.id
                ? "Retry making this season current"
                : `Continue with selected ${isSeason ? "season" : "event"}`}
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

function EventFields({
  timezone,
  setTimezone,
}: {
  timezone: string;
  setTimezone: (value: string) => void;
}) {
  return (
    <>
      <label>
        Type
        <select
          name="eventType"
          defaultValue="tournament"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="tournament">Tournament</option>
          <option value="bonspiel">Bonspiel</option>
          <option value="league">League</option>
          <option value="playoff">Playoff</option>
          <option value="exhibition">Exhibition</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Location (optional)
        <input
          name="location"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Level (optional)
        <select
          name="level"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="">None</option>
          <option value="U15">U15</option>
          <option value="U18">U18</option>
          <option value="U20">U20</option>
          <option value="U25">U25</option>
          <option value="Men’s">Men’s</option>
          <option value="Women’s">Women’s</option>
        </select>
      </label>
      <label>
        Result (optional)
        <select
          name="result"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="">None</option>
          <option value="1st">1st place</option>
          <option value="2nd">2nd place</option>
          <option value="3rd">3rd place</option>
          <option value="qualified">Qualified</option>
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-3 sm:col-span-2">
        <input
          name="showLevel"
          type="checkbox"
          defaultChecked
          className="h-5 w-5"
        />
        Show the level in public accomplishments
      </label>
      <AccomplishmentYearSelect />
      <label className="sm:col-span-2">
        Timezone
        <TimezoneSelect
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </label>
    </>
  );
}

function createdId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function suggestedSeasonName(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 5 ? year : year - 1;
  return `${startYear}–${String(startYear + 1).slice(-2)}`;
}
