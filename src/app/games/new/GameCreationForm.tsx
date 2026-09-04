"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EventRecord,
  ScheduledGameRecord,
  SeasonRecord,
} from "@/lib/team-hierarchy-data";

type Opponent = { id: string; display_name: string };
export function GameCreationForm({
  teamName,
  season,
  events,
  opponents,
  games,
  preselectedEventId,
}: {
  teamName: string;
  season: SeasonRecord;
  events: EventRecord[];
  opponents: Opponent[];
  games: ScheduledGameRecord[];
  preselectedEventId: string;
}) {
  const router = useRouter();
  const [eventId, setEventId] = useState(preselectedEventId);
  const [opponentSearch, setOpponentSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedEvent = events.find((event) => event.id === eventId)!;
  const suggested = useMemo(
    () =>
      Math.max(
        0,
        ...games
          .filter((game) => game.eventId === eventId)
          .map((game) => game.gameNumber ?? 0),
      ) + 1,
    [eventId, games],
  );
  const matching = opponents.find(
    (opponent) =>
      opponent.display_name.trim().toLocaleLowerCase() ===
      opponentSearch.trim().replace(/\s+/g, " ").toLocaleLowerCase(),
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const gameNumber = Number(form.get("gameNumber"));
    const label = String(form.get("gameLabel") ?? "").trim();
    const response = await fetch("/api/team-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "createGame",
        eventId,
        ...(matching
          ? { opponentId: matching.id }
          : { opponentName: opponentSearch }),
        scheduledDate: form.get("scheduledDate"),
        scheduledTime: form.get("scheduledTime"),
        timezone: selectedEvent.timezone,
        gameNumber,
        gameLabel: label || undefined,
        config: {
          eventName: label || `${selectedEvent.name} — Game ${gameNumber}`,
          homeName: teamName,
          awayName:
            matching?.display_name ??
            opponentSearch.trim().replace(/\s+/g, " "),
          homeColor: form.get("homeColor"),
          awayColor: form.get("awayColor"),
          scheduledEnds: Number(form.get("scheduledEnds")),
          youtubeTitle: form.get("youtubeTitle"),
          youtubeVisibility: form.get("youtubeVisibility"),
        },
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error ?? "Game could not be scheduled.");
      setBusy(false);
      return;
    }
    localStorage.setItem(
      `curlcast-access-${body.game.id}`,
      body.organizerToken,
    );
    router.push(`/games/${body.game.id}`);
  }
  return (
    <form onSubmit={submit} className="panel grid gap-4 md:grid-cols-2">
      <h1 className="text-3xl font-black md:col-span-2">Schedule a game</h1>
      <label>
        Season
        <input
          readOnly
          value={season.name}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3 text-slate-300"
        />
      </label>
      <label>
        Event
        <select
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Team 1 — Your team
        <input
          readOnly
          value={teamName}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3 text-slate-300"
        />
      </label>
      <label>
        Team 2 — Opponent
        <input
          required
          list="opponents"
          value={opponentSearch}
          onChange={(e) => setOpponentSearch(e.target.value)}
          placeholder="Search or add a new opponent"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
        <datalist id="opponents">
          {opponents.map((opponent) => (
            <option key={opponent.id} value={opponent.display_name} />
          ))}
        </datalist>
        <span className="text-sm text-slate-400">
          {opponentSearch && !matching
            ? `Add new opponent “${opponentSearch.trim()}”`
            : "Choose a remembered opponent or type a new one."}
        </span>
      </label>
      <label>
        Scheduled date
        <input
          required
          name="scheduledDate"
          type="date"
          min={selectedEvent.startDate}
          max={selectedEvent.endDate}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Scheduled time
        <input
          required
          name="scheduledTime"
          type="time"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <p className="rounded-lg bg-slate-800 p-3 md:col-span-2">
        Event timezone: <strong>{selectedEvent.timezone}</strong>
      </p>
      <label>
        Game number
        <input
          key={`${eventId}-${suggested}`}
          required
          name="gameNumber"
          type="number"
          min="1"
          defaultValue={suggested}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Game label (optional)
        <input
          name="gameLabel"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Team 1 colour
        <input
          name="homeColor"
          type="color"
          defaultValue="#ef4444"
          className="mt-1 min-h-11 w-full bg-slate-800"
        />
      </label>
      <label>
        Team 2 colour
        <input
          name="awayColor"
          type="color"
          defaultValue="#2563eb"
          className="mt-1 min-h-11 w-full bg-slate-800"
        />
      </label>
      <label>
        Scheduled ends
        <select
          name="scheduledEnds"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option>8</option>
          <option>10</option>
        </select>
      </label>
      <label>
        Broadcast visibility
        <select
          name="youtubeVisibility"
          defaultValue="unlisted"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
      </label>
      <label className="md:col-span-2">
        Broadcast title
        <input
          required
          name="youtubeTitle"
          defaultValue={`${teamName} curling`}
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <button disabled={busy} className="btn md:col-span-2">
        {busy ? "Scheduling…" : "Schedule game"}
      </button>
      {error && (
        <p role="alert" className="text-red-300 md:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
