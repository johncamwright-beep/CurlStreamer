"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EventRecord,
  ScheduledGameRecord,
  SeasonRecord,
} from "@/lib/team-hierarchy-data";

type Opponent = { id: string; display_name: string };
type Dialog = "season" | "event" | null;
export function GameCreationForm({
  teamName,
  seasons: initialSeasons,
  events: initialEvents,
  opponents,
  games,
  preselectedEventId,
  editing,
  editingTitle,
}: {
  teamName: string;
  seasons: SeasonRecord[];
  events: EventRecord[];
  opponents: Opponent[];
  games: ScheduledGameRecord[];
  preselectedEventId?: string;
  editing?: ScheduledGameRecord;
  editingTitle?: string;
}) {
  const router = useRouter();
  const current =
    initialSeasons.find((s) => s.status === "active") ??
    initialSeasons.find((s) => s.status !== "archived");
  const preselected = initialEvents.find(
    (e) => e.id === preselectedEventId && !e.archivedAt,
  );
  const [seasons, setSeasons] = useState(initialSeasons);
  const [events, setEvents] = useState(initialEvents);
  const [seasonId, setSeasonId] = useState(
    editing?.seasonId ?? preselected?.seasonId ?? current?.id ?? "",
  );
  const [eventId, setEventId] = useState<string>(
    editing?.eventId ?? preselected?.id ?? "",
  );
  const [opponentSearch, setOpponentSearch] = useState(
    editing?.opponentId
      ? (opponents.find((o) => o.id === editing.opponentId)?.display_name ?? "")
      : "",
  );
  const [opponentTbd, setOpponentTbd] = useState(
    editing ? !editing.opponentId : false,
  );
  const [dialog, setDialog] = useState<Dialog>(
    initialSeasons.length ? null : "season",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const availableEvents = events.filter(
    (e) => e.seasonId === seasonId && !e.archivedAt,
  );
  const selectedEvent = availableEvents.find((e) => e.id === eventId);
  const suggested = useMemo(
    () =>
      Math.max(
        0,
        ...games
          .filter((g) => g.eventId === eventId && g.id !== editing?.id)
          .map((g) => g.gameNumber ?? 0),
      ) + 1,
    [eventId, games, editing?.id],
  );
  const matching = opponents.find(
    (o) =>
      o.display_name.trim().toLocaleLowerCase() ===
      opponentSearch.trim().replace(/\s+/g, " ").toLocaleLowerCase(),
  );
  function chooseSeason(value: string) {
    if (value === "__new") return setDialog("season");
    setSeasonId(value);
    if (!events.some((e) => e.id === eventId && e.seasonId === value))
      setEventId("");
  }
  async function mutate(payload: unknown) {
    const response = await fetch("/api/team-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(body?.error ?? "The change could not be saved.");
    return body;
  }
  async function createSeason(form: FormData) {
    setBusy(true);
    setError("");
    try {
      const id = await mutate({
        operation: "createSeason",
        input: {
          name: form.get("name"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
        },
      });
      const season: SeasonRecord = {
        id,
        name: String(form.get("name")),
        startDate: String(form.get("startDate")),
        endDate: String(form.get("endDate")),
        status: "draft",
      };
      setSeasons((v) => [...v, season]);
      setSeasonId(id);
      setEventId("");
      if (form.get("makeCurrent")) {
        await mutate({ operation: "activateSeason", seasonId: id });
        setSeasons((v) =>
          v.map((s) => ({
            ...s,
            status:
              s.id === id
                ? "active"
                : s.status === "active"
                  ? "draft"
                  : s.status,
          })),
        );
      }
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Season could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function createEvent(form: FormData) {
    setBusy(true);
    setError("");
    try {
      const input = {
        seasonId,
        name: form.get("name"),
        eventType: form.get("eventType"),
        startDate: form.get("startDate"),
        endDate: form.get("endDate"),
        location: String(form.get("location") || "") || undefined,
        timezone: form.get("timezone"),
      };
      const id = await mutate({ operation: "createEvent", input });
      setEvents((v) => [
        ...v,
        {
          id,
          ...input,
          location: input.location ?? null,
          archivedAt: null,
        } as EventRecord,
      ]);
      setEventId(id);
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Event could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const date = String(form.get("scheduledDate"));
    const gameNumber = eventId ? Number(form.get("gameNumber")) : null;
    const opponentName = opponentSearch.trim().replace(/\s+/g, " ");
    try {
      const body = await mutate({
        operation: editing ? "updateGame" : "createGame",
        ...(editing ? { gameId: editing.id } : {}),
        seasonId,
        eventId: eventId || null,
        ...(opponentTbd
          ? {}
          : matching
            ? { opponentId: matching.id }
            : { opponentName }),
        scheduledDate: date,
        scheduledTime: form.get("scheduledTime"),
        timezone: selectedEvent?.timezone ?? form.get("timezone"),
        gameNumber,
        config: {
          eventName: selectedEvent?.name ?? "Single Game",
          homeName: teamName,
          awayName: opponentTbd ? "Opponent TBD" : opponentName,
          homeColor: form.get("homeColor"),
          awayColor: form.get("awayColor"),
          scheduledEnds: Number(form.get("scheduledEnds")),
          youtubeTitle: form.get("youtubeTitle"),
          youtubeVisibility: form.get("youtubeVisibility"),
        },
      });
      if (!editing)
        localStorage.setItem(
          `curlcast-access-${body.game.id}`,
          body.organizerToken,
        );
      router.push(editing ? "/dashboard" : `/games/${body.game.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Game could not be saved.");
      setBusy(false);
    }
  }
  const local = editing?.scheduledStart
    ? new Date(editing.scheduledStart)
    : null;
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <LinkText href="/dashboard">Dashboard</LinkText>
        <span> → {editing ? "Edit Schedule" : "Schedule a Game"}</span>
      </nav>
      <form onSubmit={submit} className="panel grid gap-4 md:grid-cols-2">
        <h1 className="text-3xl font-black md:col-span-2">
          {editing ? `Edit Schedule — ${editingTitle}` : "Schedule a Game"}
        </h1>
        <label>
          Season
          <select
            required
            value={seasonId}
            onChange={(e) => chooseSeason(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
          >
            <option value="" disabled>
              Select a season
            </option>
            {seasons
              .filter((s) => s.status !== "archived")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === "active" ? " (Current)" : ""}
                </option>
              ))}
            <option value="__new">Create New Season…</option>
          </select>
        </label>
        <label>
          Event
          <select
            disabled={!seasonId}
            value={eventId}
            onChange={(e) =>
              e.target.value === "__new"
                ? setDialog("event")
                : setEventId(e.target.value)
            }
            className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
          >
            <option value="">Single Game</option>
            {availableEvents.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
            <option value="__new">Create New Event…</option>
          </select>
        </label>
        <label>
          Team 1 — Your Team
          <input
            readOnly
            value={teamName}
            className="mt-1 w-full rounded-lg bg-slate-800 p-3 text-slate-300"
          />
        </label>
        <label>
          Team 2 — Opponent
          <input
            disabled={opponentTbd}
            required={!opponentTbd}
            list="opponents"
            value={opponentSearch}
            onChange={(e) => setOpponentSearch(e.target.value)}
            placeholder="Search or add a new opponent"
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
          <datalist id="opponents">
            {opponents.map((o) => (
              <option key={o.id} value={o.display_name} />
            ))}
          </datalist>
          <span className="mt-2 flex items-center gap-2">
            <input
              className="h-6 w-6"
              type="checkbox"
              checked={opponentTbd}
              onChange={(e) => setOpponentTbd(e.target.checked)}
            />{" "}
            Opponent TBD
          </span>
        </label>
        <label>
          Scheduled date
          <input
            required
            name="scheduledDate"
            type="date"
            defaultValue={local?.toISOString().slice(0, 10)}
            min={selectedEvent?.startDate}
            max={selectedEvent?.endDate}
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        <label>
          Scheduled time
          <input
            required
            name="scheduledTime"
            type="time"
            defaultValue={local?.toISOString().slice(11, 16)}
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        {selectedEvent ? (
          <p className="rounded-lg bg-slate-800 p-3 md:col-span-2">
            Event timezone: <strong>{selectedEvent.timezone}</strong>
          </p>
        ) : (
          <label>
            Timezone
            <input
              required
              name="timezone"
              defaultValue="UTC"
              placeholder="America/Edmonton"
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
            />
          </label>
        )}
        {eventId && (
          <label>
            Game number
            <input
              key={`${eventId}-${suggested}`}
              required
              name="gameNumber"
              type="number"
              min="1"
              defaultValue={
                editing?.eventId === eventId
                  ? (editing.gameNumber ?? suggested)
                  : suggested
              }
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
            />
          </label>
        )}
        <label>
          Team 1 colour
          <input
            name="homeColor"
            type="color"
            defaultValue={editing?.config.homeColor ?? "#ef4444"}
            className="mt-1 min-h-11 w-full bg-slate-800"
          />
        </label>
        <label>
          Team 2 colour
          <input
            name="awayColor"
            type="color"
            defaultValue={editing?.config.awayColor ?? "#2563eb"}
            className="mt-1 min-h-11 w-full bg-slate-800"
          />
        </label>
        <label>
          Scheduled ends
          <select
            name="scheduledEnds"
            defaultValue={editing?.config.scheduledEnds ?? 8}
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
            defaultValue={editing?.config.youtubeVisibility ?? "unlisted"}
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
            defaultValue={editing?.config.youtubeTitle ?? `${teamName} curling`}
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        <button disabled={busy || !seasonId} className="btn md:col-span-2">
          {busy ? "Saving…" : editing ? "Save schedule" : "Schedule game"}
        </button>
        {error && (
          <p role="alert" className="text-red-300 md:col-span-2">
            {error}
          </p>
        )}
      </form>
      {dialog && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inline-heading"
            className="panel w-full max-w-lg"
          >
            <h2 id="inline-heading" className="text-2xl font-bold">
              Create New {dialog === "season" ? "Season" : "Event"}
            </h2>
            <form
              className="mt-4 grid gap-3"
              action={dialog === "season" ? createSeason : createEvent}
            >
              <label>
                Name
                <input
                  required
                  name="name"
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              {dialog === "event" && (
                <label>
                  Type
                  <select
                    name="eventType"
                    className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                  >
                    <option value="tournament">Tournament</option>
                    <option value="bonspiel">Bonspiel</option>
                    <option value="league">League</option>
                    <option value="playoff">Playoff</option>
                    <option value="exhibition">Exhibition Series</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              )}
              <label>
                Start date
                <input
                  required
                  name="startDate"
                  type="date"
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              <label>
                End date
                <input
                  required
                  name="endDate"
                  type="date"
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              {dialog === "event" ? (
                <>
                  <label>
                    Location (optional)
                    <input
                      name="location"
                      className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                    />
                  </label>
                  <label>
                    IANA timezone
                    <input
                      required
                      name="timezone"
                      defaultValue="UTC"
                      className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                    />
                  </label>
                </>
              ) : (
                !current && (
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      name="makeCurrent"
                      defaultChecked
                      className="h-6 w-6"
                    />{" "}
                    Make this the current season
                  </label>
                )
              )}
              <div className="flex gap-3">
                <button disabled={busy} className="btn">
                  Create
                </button>
                {initialSeasons.length > 0 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDialog(null)}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {error && (
                <p role="alert" className="text-red-300">
                  {error}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
function LinkText({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a className="inline-flex min-h-11 items-center text-cyan-300" href={href}>
      {children}
    </a>
  );
}
