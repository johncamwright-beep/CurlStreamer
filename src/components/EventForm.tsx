"use client";
import { useEffect, useState } from "react";
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
  const [timezone, setTimezone] = useState(event?.timezone ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!event)
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, [event]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const input = {
      seasonId,
      name: form.get("name"),
      eventType: form.get("eventType"),
      startDate: form.get("startDate"),
      endDate: form.get("endDate"),
      location: form.get("location") || undefined,
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
    if (!event) e.currentTarget.reset();
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
        IANA timezone
        <input
          name="timezone"
          required
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="America/Toronto"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
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
