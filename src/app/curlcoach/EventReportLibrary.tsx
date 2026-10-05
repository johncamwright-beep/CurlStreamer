"use client";
import { useEffect, useState } from "react";
import EventReports from "./EventReports";
type EventItem = {
  id: string;
  name: string;
  date: string | null;
  complete: boolean;
  saved: number;
  processing: boolean;
};
export default function EventReportLibrary() {
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/curlcoach/report-events", {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (!abort.signal.aborted) setEvents(data.events);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e.message ?? "Event list unavailable.");
      });
    return () => abort.abort();
  }, [selected]);
  if (selected)
    return (
      <div className="space-y-4">
        <button
          className="min-h-11 underline"
          onClick={() => setSelected(null)}
        >
          ← All events
        </button>
        <h2 className="text-2xl font-bold">{selected.name}</h2>
        <EventReports key={selected.id} eventId={selected.id} />
      </div>
    );
  return (
    <section className="space-y-5" aria-label="Event reports library">
      <h2 className="text-2xl font-bold">Event reports</h2>
      <p>Choose an event. Reports are only generated when you request them.</p>
      {error && <p role="alert">{error}</p>}
      {!events && !error && <p role="status">Loading events…</p>}
      {events?.length === 0 && <p>Your scheduled events will appear here.</p>}
      <ul className="space-y-3">
        {events?.map((e) => (
          <li
            className="event-card flex flex-wrap items-center justify-between gap-4 p-4"
            key={e.id}
          >
            <div>
              <h3 className="font-bold">{e.name}</h3>
              <p className="mt-1 text-sm">
                {e.date}
                {e.date ? " · " : ""}
                {e.processing
                  ? "Generating"
                  : e.saved === 3
                    ? "Reports ready"
                    : e.saved
                      ? "Some reports ready"
                      : e.complete
                        ? "Not generated"
                        : "Event in progress"}
              </p>
            </div>
            <button
              className="btn min-h-11"
              disabled={!e.saved && !e.complete && !e.processing}
              onClick={() => setSelected(e)}
            >
              {e.saved
                ? "View reports"
                : e.processing
                  ? "View progress"
                  : "Generate reports"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
