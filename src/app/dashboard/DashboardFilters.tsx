"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  dashboardHref,
  parseGameSearch,
  parseGameView,
  type DashboardQuery,
} from "./dashboard-query";

export function DashboardFilters({
  query,
  events,
}: {
  query: DashboardQuery;
  events: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const apply = (changes: Partial<DashboardQuery>) => {
    startTransition(() => router.push(dashboardHref({ ...query, ...changes })));
  };

  return (
    <div className="dashboard-filters" aria-busy={pending}>
      <select
        aria-label="Games view"
        value={
          query.tab === "all" && query.event
            ? `event:${query.event}`
            : query.tab
        }
        disabled={pending}
        onChange={({ target: { value } }) => {
          if (value.startsWith("event:")) {
            apply({ tab: "all", event: value.slice("event:".length) });
            return;
          }
          const tab = parseGameView(value);
          apply({ tab, event: tab === "all" ? undefined : query.event });
        }}
      >
        <option value="all">All games</option>
        <option value="upcoming">Upcoming</option>
        <option value="events">Events</option>
        <option value="past">Results</option>
        <option value="unfinished">Unfinished</option>
        <option value="single">Upcoming standalone games</option>
        <optgroup label="Filter by event">
          <option value="event:single">Standalone games</option>
          {events.map(({ id, name }) => (
            <option key={id} value={`event:${id}`}>
              {name}
            </option>
          ))}
        </optgroup>
      </select>
      <select
        aria-label="Sort games"
        value={query.sort}
        disabled={pending}
        onChange={({ target }) =>
          apply({ sort: target.value === "oldest" ? "oldest" : "newest" })
        }
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      <form
        className="dashboard-search"
        action="/dashboard"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply({
            search: parseGameSearch(new FormData(event.currentTarget).get("q")),
          });
        }}
      >
        {query.tab !== "all" && (
          <input type="hidden" name="tab" value={query.tab} />
        )}
        {query.season && (
          <input type="hidden" name="season" value={query.season} />
        )}
        {query.event && (
          <input type="hidden" name="event" value={query.event} />
        )}
        {query.sort !== "newest" && (
          <input type="hidden" name="sort" value={query.sort} />
        )}
        <button type="submit" aria-label="Search" disabled={pending}>
          <span className="dashboard-search-icon" aria-hidden="true" />
        </button>
        <input
          key={query.search}
          type="search"
          name="q"
          aria-label="Search teams or events"
          placeholder="Search teams or events"
          defaultValue={query.search}
          maxLength={120}
        />
      </form>
    </div>
  );
}

export function DashboardSeasonSelect({
  query,
  seasons,
}: {
  query: DashboardQuery;
  seasons: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!seasons.length)
    return <span className="dashboard-season-label">No season set up</span>;
  return (
    <select
      aria-label="Choose season"
      className="dashboard-season-select"
      value={query.season}
      disabled={pending}
      onChange={({ target }) => {
        const href = dashboardHref({
          ...query,
          season: target.value,
          event: undefined,
        });
        startTransition(() => router.push(href));
      }}
    >
      {seasons.map(({ id, name }) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
}
