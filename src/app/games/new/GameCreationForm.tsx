"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EventRecord,
  ScheduledGameRecord,
  SeasonRecord,
} from "@/lib/team-hierarchy-data";
import {
  formatCanonicalGameTitle,
  formatYouTubeScheduledTitle,
} from "@/lib/game-title";
import {
  localDateTimeToUtc,
  scheduledStartToLocalInput,
  formatScheduledStart,
} from "@/lib/team-hierarchy";
import { RockColourSelector } from "@/components/RockColourSelector";

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
  const editingEvent = initialEvents.find(
    (event) => event.id === editing?.eventId && !event.archivedAt,
  );
  const initialTimezone =
    editingEvent?.timezone ??
    editing?.timezone ??
    preselected?.timezone ??
    "UTC";
  const initialSchedule = editing?.scheduledStart
    ? scheduledStartToLocalInput(editing.scheduledStart, initialTimezone)
    : null;
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
  const saving = useRef(false);
  const [homeColor, setHomeColor] = useState(
    editing?.config.homeColor ?? "#ef4444",
  );
  const [awayColor, setAwayColor] = useState(
    editing?.config.awayColor ?? "#2563eb",
  );
  const [ends, setEnds] = useState(editing?.config.scheduledEnds ?? 8);
  const [visibility, setVisibility] = useState(
    editing?.config.youtubeVisibility ?? "unlisted",
  );
  const [error, setError] = useState("");
  const [scheduledDate, setScheduledDate] = useState(
    initialSchedule?.date ?? "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    initialSchedule?.time ?? "",
  );
  const [timezone, setTimezone] = useState(editing?.timezone ?? "UTC");
  const [titleCustomized, setTitleCustomized] = useState(
    Boolean(editing?.config.youtubeTitle),
  );
  const [customTitle, setCustomTitle] = useState(
    editing?.config.youtubeTitle ?? "",
  );
  const availableEvents = events.filter(
    (e) => e.seasonId === seasonId && !e.archivedAt,
  );
  const selectedEvent = availableEvents.find((e) => e.id === eventId);
  const effectiveTimezone = selectedEvent?.timezone ?? timezone;
  const canonicalTitle = formatCanonicalGameTitle({
    homeName: teamName,
    awayName: opponentTbd ? null : opponentSearch,
    eventName: selectedEvent?.name ?? null,
  });
  const scheduledInstant = localDateTimeToUtc(
    scheduledDate,
    scheduledTime,
    effectiveTimezone,
    editing?.scheduledStart,
  );
  const invalidSchedule = Boolean(
    scheduledDate && scheduledTime && !scheduledInstant,
  );
  const generatedTitle = formatYouTubeScheduledTitle(
    canonicalTitle,
    scheduledInstant,
    effectiveTimezone,
  );
  const youtubeTitle = titleCustomized ? customTitle : generatedTitle;
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
    if (saving.current) return;
    saving.current = true;
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
          youtubeTitle,
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
      saving.current = false;
    }
  }
  return (
    <>
      <nav aria-label="Breadcrumb" className="setup-breadcrumb">
        <LinkText href="/dashboard">← Games</LinkText>
        <span>{editing ? "Edit schedule" : "New game"}</span>
      </nav>
      <header className="setup-heading">
        <p className="setup-eyebrow">Match preparation</p>
        <h1>{editing ? "Edit schedule" : "Schedule a game"}</h1>
        <p>
          {editing
            ? editingTitle
            : "Set up the match now. Connect cameras and start broadcasting when you’re ready."}
        </p>
      </header>
      <form
        onSubmit={submit}
        className="setup-form"
        onInvalidCapture={(e) => {
          const details = (e.target as HTMLElement).closest("details");
          if (details) details.open = true;
        }}
      >
        <fieldset disabled={busy} className="setup-fields">
          <section className="setup-card" aria-labelledby="setup-match">
            <div className="setup-section-heading">
              <span>1</span>
              <div>
                <h2 id="setup-match">Teams & event</h2>
                <p>Choose where this game belongs and who is playing.</p>
              </div>
            </div>
            <div className="setup-grid">
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
              <div>
                <label htmlFor="setup-opponent">Team 2 — Opponent</label>
                <input
                  id="setup-opponent"
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
                <label className="setup-checkbox">
                  <input
                    className="h-6 w-6"
                    type="checkbox"
                    checked={opponentTbd}
                    onChange={(e) => setOpponentTbd(e.target.checked)}
                  />{" "}
                  Opponent TBD
                </label>
                <p className="setup-help">
                  Choose a saved opponent or enter a new name. You can assign an
                  unknown opponent later.
                </p>
              </div>
            </div>
          </section>
          <section className="setup-card" aria-labelledby="setup-schedule">
            <div className="setup-section-heading">
              <span>2</span>
              <div>
                <h2 id="setup-schedule">Date & time</h2>
                <p>Use the timezone where the game will be played.</p>
              </div>
            </div>
            <div className="setup-grid">
              <label>
                Scheduled date ({effectiveTimezone})
                <input
                  required
                  name="scheduledDate"
                  type="date"
                  value={scheduledDate}
                  onChange={(event) => setScheduledDate(event.target.value)}
                  min={selectedEvent?.startDate}
                  max={selectedEvent?.endDate}
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              <label>
                Scheduled time ({effectiveTimezone})
                <input
                  required
                  name="scheduledTime"
                  type="time"
                  value={scheduledTime}
                  onChange={(event) => setScheduledTime(event.target.value)}
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
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="America/Edmonton"
                    className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                  />
                </label>
              )}
              <details className="setup-time-help md:col-span-2">
                <summary>About timezones and daylight saving</summary>
                <p>
                  Times are entered in <strong>{effectiveTimezone}</strong>. An
                  unchanged edit keeps its existing instant; a newly entered
                  time that repeats when clocks fall back uses the earlier
                  occurrence.
                </p>
              </details>
              {invalidSchedule && (
                <p role="alert" className="text-red-300 md:col-span-2">
                  That local date and time is not valid in {effectiveTimezone}.
                  Times skipped when clocks move forward cannot be scheduled.
                </p>
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
            </div>
          </section>
          <details className="setup-card setup-options">
            <summary>
              <strong>Rock colours & game length</strong>
              <span>{ends} ends · choose standard or custom colours</span>
            </summary>
            <div className="setup-grid setup-options-body">
              <RockColourSelector
                name="homeColor"
                label="Team 1 rock colour"
                defaultValue={homeColor}
                onValueChange={setHomeColor}
              />
              <RockColourSelector
                name="awayColor"
                label="Team 2 rock colour"
                defaultValue={awayColor}
                onValueChange={setAwayColor}
              />
              <label>
                Scheduled ends
                <select
                  name="scheduledEnds"
                  value={ends}
                  onChange={(e) => setEnds(Number(e.target.value) as 8 | 10)}
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                >
                  <option>8</option>
                  <option>10</option>
                </select>
              </label>
            </div>
          </details>
          <details className="setup-card setup-options">
            <summary>
              <strong>YouTube broadcast settings</strong>
              <span>
                {visibility === "unlisted"
                  ? "Unlisted · anyone with the link"
                  : visibility === "private"
                    ? "Private · restricted viewing"
                    : "Public · visible to everyone"}
              </span>
            </summary>
            <p className="setup-help">
              These settings apply to this game. Saving does not start a stream.
            </p>
            <div className="setup-grid setup-options-body">
              <label>
                Broadcast visibility
                <select
                  name="youtubeVisibility"
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as typeof visibility)
                  }
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                >
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <label className="md:col-span-2">
                YouTube title
                <input
                  required
                  name="youtubeTitle"
                  value={youtubeTitle}
                  readOnly={!titleCustomized}
                  onChange={(event) => setCustomTitle(event.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                />
                <span className="mt-2 flex flex-wrap gap-3">
                  {!titleCustomized ? (
                    <button
                      type="button"
                      className="min-h-11 text-cyan-300"
                      onClick={() => {
                        setCustomTitle(generatedTitle);
                        setTitleCustomized(true);
                      }}
                    >
                      Customize title
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="min-h-11 text-cyan-300"
                      onClick={() => setTitleCustomized(false)}
                    >
                      Reset to generated title
                    </button>
                  )}
                </span>
              </label>
            </div>
            <LinkText href="/settings/youtube">
              Manage your team’s YouTube connection →
            </LinkText>
          </details>
        </fieldset>
        <aside
          className="setup-card setup-review"
          aria-labelledby="setup-review-heading"
        >
          <p className="setup-eyebrow">Before you save</p>
          <h2 id="setup-review-heading">Review game</h2>
          <div className="setup-match-preview">
            <div>
              <span style={{ backgroundColor: homeColor }} aria-hidden="true" />
              <strong>{teamName}</strong>
            </div>
            <div>
              <span style={{ backgroundColor: awayColor }} aria-hidden="true" />
              <strong>
                {opponentTbd
                  ? "Opponent TBD"
                  : opponentSearch.trim() || "Choose an opponent"}
              </strong>
            </div>
          </div>
          <dl>
            <div>
              <dt>Season</dt>
              <dd>
                {seasons.find((s) => s.id === seasonId)?.name ??
                  "Choose a season"}
              </dd>
            </div>
            <div>
              <dt>Event</dt>
              <dd>{selectedEvent?.name ?? "Single game"}</dd>
            </div>
            <div>
              <dt>Start time</dt>
              <dd>
                {scheduledInstant
                  ? formatScheduledStart(scheduledInstant, effectiveTimezone)
                  : "Choose a valid date, time and timezone"}
              </dd>
            </div>
            <div>
              <dt>Game length</dt>
              <dd>{ends} ends</dd>
            </div>
            <div>
              <dt>YouTube visibility</dt>
              <dd>
                {visibility === "unlisted"
                  ? "Unlisted"
                  : visibility === "private"
                    ? "Private"
                    : "Public"}
              </dd>
            </div>
            <div>
              <dt>YouTube title</dt>
              <dd>{youtubeTitle || "Enter a title in YouTube settings"}</dd>
            </div>
          </dl>
          {opponentTbd && (
            <p className="setup-notice">
              You can save with Opponent TBD. Assign the opponent before scoring
              begins.
            </p>
          )}
          {(!seasonId ||
            !scheduledInstant ||
            (!opponentTbd && !opponentSearch.trim())) && (
            <p className="setup-help">
              Still needed:{" "}
              {[
                !seasonId && "season",
                !scheduledInstant && "date, time and timezone",
                !opponentTbd && !opponentSearch.trim() && "opponent",
              ]
                .filter(Boolean)
                .join("; ")}
              .
            </p>
          )}
          <button
            disabled={busy || !seasonId || !scheduledInstant}
            className="btn md:col-span-2"
          >
            {busy ? "Saving…" : editing ? "Save schedule" : "Schedule game"}
          </button>
          {error && (
            <p role="alert" className="text-red-300 md:col-span-2">
              {error}
            </p>
          )}
          <p className="setup-help">
            {editing
              ? "Your changes update this game’s schedule and settings."
              : "Next: invite cameras and open the game controls."}
          </p>
        </aside>
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
