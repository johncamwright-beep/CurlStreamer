"use client";
import { useState } from "react";
import { DEFAULT_TIMEZONE, TimezoneSelect } from "./TimezoneSelect";
import { useRouter } from "next/navigation";
import type { EventRecord } from "@/lib/team-hierarchy-data";

export function EventForm({
  seasonId,
  event,
}: {
  seasonId: string;
  event?: EventRecord;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(event?.timezone ?? DEFAULT_TIMEZONE);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const input = {
      seasonId,
      name: form.get("name"),
      eventType: form.get("eventType"),
      startDate: form.get("startDate"),
      endDate: form.get("endDate"),
      location: form.get("location") || undefined,
      result: form.get("result") || null,
      level: form.get("level") || null,
      showLevel: form.get("showLevel") === "on",
      timezone,
    };
    const response = await fetch("/api/team-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: event ? "updateEvent" : "createEvent",
        eventId: event?.id,
        input,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Event could not be saved.");
      setBusy(false);
      return;
    }
    router.refresh();
    if (!event) formElement.reset();
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-2">
      <h2 className="text-xl font-bold sm:col-span-2">
        {event ? "Edit event" : "Create an event"}
      </h2>
      <label>
        Event name
        <input
          name="name"
          required
          defaultValue={event?.name}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Type
        <select
          name="eventType"
          required
          defaultValue={event?.eventType ?? "tournament"}
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="tournament">Tournament</option>
          <option value="bonspiel">Bonspiel</option>
          <option value="league">League</option>
          <option value="exhibition">Exhibition</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Start date
        <input
          name="startDate"
          type="date"
          required
          defaultValue={event?.startDate}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        End date
        <input
          name="endDate"
          type="date"
          required
          defaultValue={event?.endDate}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Location (optional)
        <input
          name="location"
          defaultValue={event?.location ?? ""}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Result (optional)
        <select
          name="result"
          defaultValue={event?.result ?? ""}
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="">None</option>
          <option value="1st">1st place</option>
          <option value="2nd">2nd place</option>
          <option value="3rd">3rd place</option>
          <option value="qualified">Qualified</option>
        </select>
      </label>
      <label>
        Level (optional)
        <select
          name="level"
          defaultValue={event?.level ?? ""}
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
      <label className="flex min-h-11 items-center gap-3 sm:col-span-2">
        <input
          name="showLevel"
          type="checkbox"
          defaultChecked={event?.showLevel ?? true}
          className="h-5 w-5"
        />
        Show the level in public accomplishments
      </label>
      <label>
        Timezone
        <TimezoneSelect
          name="timezone"
          required
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
      </label>
      <button disabled={busy} className="btn sm:col-span-2">
        {busy ? "Saving…" : event ? "Save event" : "Create event"}
      </button>
      {error && (
        <p role="alert" className="text-red-300 sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
