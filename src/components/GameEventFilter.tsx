"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function GameEventFilter({
  events,
  selected,
  season,
  tab,
}: {
  events: { id: string; name: string }[];
  selected: string;
  season?: string;
  tab: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="dashboard-event-filter">
      <span>Filter by event</span>
      <select
        className="input"
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const params = new URLSearchParams({
            tab,
            ...(season ? { season } : {}),
            ...(event.target.value ? { event: event.target.value } : {}),
          });
          startTransition(() => router.push(`/dashboard?${params}`));
        }}
      >
        <option value="">All events</option>
        <option value="single">Single games (no event)</option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name}
          </option>
        ))}
      </select>
      {pending && <span role="status">Filtering…</span>}
    </label>
  );
}
