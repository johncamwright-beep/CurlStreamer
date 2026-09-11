"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EventRecord,
  ScheduledGameRecord,
  SeasonRecord,
} from "@/lib/team-hierarchy-data";
import {
  formatCanonicalGameTitle,
  formatEventGameLabel,
  formatYouTubeScheduledTitle,
} from "@/lib/game-title";
import {
  localDateTimeToUtc,
  scheduledStartToLocalInput,
  formatScheduledStart,
} from "@/lib/team-hierarchy";
import { RockColourSelector } from "@/components/RockColourSelector";
import { OpponentProfilePicker } from "@/components/OpponentProfilePicker";
import { DEFAULT_TIMEZONE, TimezoneSelect } from "@/components/TimezoneSelect";

type Opponent = { id: string; display_name: string };
type Dialog = "season" | "event" | null;
export function GameCreationForm({
  teamName,
  seasons: initialSeasons,
  events: initialEvents,
  opponents: initialOpponents,
  games,
  preselectedEventId,
  preselectedSeasonId,
  editing,
  editingTitle,
  onCreated,
}: {
  teamName: string;
  seasons: SeasonRecord[];
  events: EventRecord[];
  opponents: Opponent[];
  games: ScheduledGameRecord[];
  preselectedEventId?: string;
  preselectedSeasonId?: string;
  editing?: ScheduledGameRecord;
  editingTitle?: string;
  onCreated?: (gameId: string) => void;
}) {
  const router = useRouter();
  const current =
    initialSeasons.find(
      (s) => s.id === preselectedSeasonId && s.status !== "archived",
    ) ??
    initialSeasons.find((s) => s.status === "active") ??
    initialSeasons.find((s) => s.status !== "archived");
  const preselected = initialEvents.find(
    (e) => e.id === preselectedEventId && !e.archivedAt,
  );
  const editingEvent = initialEvents.find(
    (event) => event.id === editing?.eventId && !event.archivedAt,
  );
  const initialTimezone =
    editing?.timezone ??
    editingEvent?.timezone ??
    preselected?.timezone ??
    DEFAULT_TIMEZONE;
  const initialSchedule = editing?.scheduledStart
    ? scheduledStartToLocalInput(editing.scheduledStart, initialTimezone)
    : null;
  const [seasons, setSeasons] = useState(initialSeasons);
  const [opponents, setOpponents] = useState(initialOpponents);
  const [events, setEvents] = useState(initialEvents);
  const [seasonId, setSeasonId] = useState(
    editing?.seasonId ?? preselected?.seasonId ?? current?.id ?? "",
  );
  const [eventId, setEventId] = useState<string>(
    editing?.eventId ?? preselected?.id ?? "",
  );
  const [gameNumberText, setGameNumberText] = useState(
    editing?.gameNumber?.toString() ?? "",
  );
  const gameForm = useRef<HTMLFormElement>(null);
  const acceptedDuplicate = useRef("");
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const [newGameNumbers, setNewGameNumbers] = useState<string[]>([]);
  const numberInUse = Boolean(
    eventId &&
    gameNumberText &&
    (newGameNumbers.includes(`${eventId}:${gameNumberText}`) ||
      games.some(
        (game) =>
          game.id !== editing?.id &&
          game.eventId === eventId &&
          game.gameNumber === Number(gameNumberText),
      )),
  );
  const [opponentChoice, setOpponentChoice] = useState(
    editing ? (editing.opponentId ?? "__tbd") : opponents.length ? "" : "__new",
  );
  const [opponentSearch, setOpponentSearch] = useState(
    editing?.opponentId
      ? (opponents.find((o) => o.id === editing.opponentId)?.display_name ??
          editing.config.awayName)
      : "",
  );
  const opponentTbd = opponentChoice === "__tbd";
  const [dialog, setDialog] = useState<Dialog>(
    initialSeasons.length ? null : "season",
  );
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  // Keeping this key for the form lifetime makes a client-side retry after a
  // lost response idempotent; the server never creates a second game.
  const creationGameId = useRef(
    typeof crypto === "undefined" ? "" : crypto.randomUUID(),
  );
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
  const [youtubeEnabled, setYoutubeEnabled] = useState(
    editing?.config.youtubeEnabled ?? false,
  );
  const [sharedYoutubeWatchUrl, setSharedYoutubeWatchUrl] = useState(
    editing?.config.sharedYoutubeWatchUrl ?? "",
  );
  const [createdGame, setCreatedGame] = useState<{
    id: string;
    youtubeStatus?: string;
    thumbnailStatus?: string;
  } | null>(null);
  const [finishedScheduling, setFinishedScheduling] = useState(false);
  const [error, setError] = useState("");
  const [scheduledDate, setScheduledDate] = useState(
    initialSchedule?.date ?? "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    initialSchedule?.time ?? "",
  );
  const [timezone, setTimezone] = useState(
    editing?.timezone ?? DEFAULT_TIMEZONE,
  );
  const [titleCustomized, setTitleCustomized] = useState(
    Boolean(
      editing?.config.youtubeTitle &&
      editing.config.youtubeTitle !==
        formatYouTubeScheduledTitle(
          editingTitle ?? "",
          editing.scheduledStart,
          initialTimezone,
        ),
    ),
  );
  const [customTitle, setCustomTitle] = useState(
    editing?.config.youtubeTitle ?? "",
  );
  const availableEvents = events.filter(
    (e) => e.seasonId === seasonId && !e.archivedAt,
  );
  const selectedEvent = availableEvents.find((e) => e.id === eventId);
  const effectiveTimezone = timezone;
  const canonicalTitle = formatCanonicalGameTitle({
    homeName: teamName,
    awayName: opponentTbd ? null : opponentSearch,
    eventName: selectedEvent?.name ?? null,
    gameNumber: eventId && gameNumberText ? Number(gameNumberText) : null,
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
  async function saveOpponent() {
    if (saving.current) return;
    const displayName = opponentSearch.trim().replace(/\s+/g, " ");
    if (!displayName) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await mutate({
        operation: "createOpponent",
        input: { displayName },
      });
      const saved = result?.[0];
      if (!saved?.opponent_id || !saved?.display_name)
        throw new Error("The opponent could not be saved. Please try again.");
      setOpponents((items) => [
        ...items.filter((item) => item.id !== saved.opponent_id),
        { id: saved.opponent_id, display_name: saved.display_name },
      ]);
      setOpponentChoice(saved.opponent_id);
      setOpponentSearch(saved.display_name);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The opponent could not be saved.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
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
        level: String(form.get("level") || "") || null,
        showLevel: form.get("showLevel") === "on",
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
    if (
      numberInUse &&
      acceptedDuplicate.current !== `${eventId}:${gameNumberText}`
    ) {
      setDuplicatePrompt(true);
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const date = String(form.get("scheduledDate"));
    const gameNumber =
      eventId && gameNumberText ? Number(gameNumberText) : null;
    const opponentName = opponentSearch.trim().replace(/\s+/g, " ");
    try {
      const body = await mutate({
        operation: editing ? "updateGame" : "createGame",
        ...(editing
          ? { gameId: editing.id }
          : { gameId: creationGameId.current }),
        seasonId,
        eventId: eventId || null,
        ...(opponentTbd
          ? {}
          : opponentChoice && opponentChoice !== "__new"
            ? { opponentId: opponentChoice }
            : matching
              ? { opponentId: matching.id }
              : { opponentName }),
        scheduledDate: date,
        scheduledTime: form.get("scheduledTime"),
        timezone,
        gameNumber,
        config: {
          eventName: formatEventGameLabel(
            selectedEvent?.name ?? "Single Game",
            gameNumber,
          ),
          homeName: teamName,
          awayName: opponentTbd ? "Opponent TBD" : opponentName,
          homeColor: form.get("homeColor"),
          awayColor: form.get("awayColor"),
          scheduledEnds: Number(form.get("scheduledEnds")),
          youtubeEnabled,
          sharedYoutubeWatchUrl,
          youtubeTitle,
          youtubeVisibility: youtubeEnabled ? "unlisted" : visibility,
        },
      });
      if (!editing)
        localStorage.setItem(
          `curlcast-access-${body.game.id}`,
          body.organizerToken,
        );
      if (!editing) {
        if (eventId && gameNumberText)
          setNewGameNumbers((numbers) => [
            ...numbers,
            `${eventId}:${gameNumberText}`,
          ]);
        setCreatedGame({
          id: body.game.id,
          thumbnailStatus: body.youtube?.thumbnailStatus,
          youtubeStatus: youtubeEnabled
            ? (body.youtube?.status ?? "pending")
            : undefined,
        });
        setBusy(false);
        saving.current = false;
        onCreated?.(body.game.id);
        return;
      }
      if (editing && body.youtube?.status === "pending") {
        setError(
          "The game was saved, but YouTube’s time could not be updated. Please save changes again to retry.",
        );
        setBusy(false);
        saving.current = false;
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Game could not be saved.");
      setBusy(false);
      saving.current = false;
    }
  }
  async function retryYouTube() {
    if (!createdGame) return;
    setBusy(true);
    setError("");
    try {
      const body = await mutate({
        operation: "retryYouTube",
        gameId: createdGame.id,
      });
      if (body.youtube?.status !== "ready") {
        setCreatedGame({
          ...createdGame,
          youtubeStatus: body.youtube?.status ?? "pending",
        });
        setBusy(false);
        return;
      }
      setCreatedGame({
        ...createdGame,
        youtubeStatus: "ready",
        thumbnailStatus: body.youtube?.thumbnailStatus,
      });
      setBusy(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "YouTube could not be reached.",
      );
      setBusy(false);
    }
  }
  if (createdGame)
    return (
      <section
        className="panel mx-auto max-w-xl space-y-5"
        aria-labelledby="game-saved-heading"
      >
        <h1 id="game-saved-heading" className="text-2xl font-bold">
          Game scheduled
        </h1>
        <p>
          {selectedEvent?.name ?? "Single game"} ·{" "}
          {formatScheduledStart(scheduledInstant!, effectiveTimezone)}
        </p>
        {createdGame.youtubeStatus &&
          (createdGame.youtubeStatus !== "ready" ||
            createdGame.thumbnailStatus === "pending") && (
            <div className="setup-notice" role="status">
              <p>
                {createdGame.youtubeStatus === "ready"
                  ? "Your watch link is ready, but YouTube could not accept its preview image. You can retry or continue scheduling."
                  : "The game was saved, but its YouTube watch page is still pending."}
              </p>
              <button
                type="button"
                className="btn-secondary mt-2"
                disabled={busy}
                onClick={retryYouTube}
              >
                {busy ? "Retrying YouTube…" : "Retry YouTube"}
              </button>
            </div>
          )}
        <h2 className="text-xl font-bold">
          {finishedScheduling
            ? "Open the last game?"
            : selectedEvent
              ? "Schedule another game for this event?"
              : "Schedule another game?"}
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (finishedScheduling) {
                router.push(`/score/${createdGame.id}`);
                return;
              }
              creationGameId.current = crypto.randomUUID();
              acceptedDuplicate.current = "";
              setCreatedGame(null);
              setScheduledTime("");
              setGameNumberText("");
              setTitleCustomized(false);
              setError("");
            }}
          >
            {finishedScheduling ? "Yes, open game" : "Yes, schedule another"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              if (finishedScheduling) {
                router.push("/dashboard");
                return;
              }
              setFinishedScheduling(true);
            }}
          >
            {finishedScheduling ? "No, view all games" : "No, I’m finished"}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
      </section>
    );
  return (
    <>
      <nav aria-label="Breadcrumb" className="setup-breadcrumb">
        <LinkText href="/dashboard">← Games</LinkText>
        <span>{editing ? "Edit game" : "New game"}</span>
      </nav>
      <header className="setup-heading">
        <p className="setup-eyebrow">Match preparation</p>
        <h1>{editing ? "Edit game" : "Schedule a game"}</h1>
        <p>
          {editing
            ? editingTitle
            : "Set up the match now. Connect cameras and start broadcasting when you’re ready."}
        </p>
      </header>
      <form
        ref={gameForm}
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
                <select
                  id="setup-opponent"
                  required
                  value={opponentChoice}
                  onChange={(e) => {
                    const choice = e.target.value;
                    setOpponentChoice(choice);
                    setOpponentSearch(
                      opponents.find((o) => o.id === choice)?.display_name ??
                        (choice === editing?.opponentId
                          ? editing.config.awayName
                          : ""),
                    );
                  }}
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                >
                  <option value="" disabled>
                    Choose an opponent
                  </option>
                  {editing?.opponentId &&
                    !opponents.some((o) => o.id === editing.opponentId) && (
                      <option value={editing.opponentId}>
                        {editing.config.awayName} (current opponent)
                      </option>
                    )}
                  {opponents.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.display_name}
                    </option>
                  ))}
                  <option value="__tbd">Opponent TBD</option>
                  <option value="__new">Add new opponent…</option>
                </select>
                {opponentChoice === "__new" && (
                  <div className="mt-3">
                    <label>
                      New opponent name
                      <input
                        required
                        maxLength={100}
                        value={opponentSearch}
                        onChange={(e) => setOpponentSearch(e.target.value)}
                        placeholder="Enter the team name"
                        className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn mt-2"
                      disabled={busy || !opponentSearch.trim()}
                      onClick={saveOpponent}
                    >
                      Save opponent
                    </button>
                  </div>
                )}
                <p className="setup-help">
                  Choose a saved team or select “Add new opponent”. You can
                  assign an unknown opponent later.
                </p>
                {opponentChoice !== "__tbd" && (
                  <OpponentProfilePicker
                    key={opponentChoice}
                    opponentId={
                      opponentChoice && opponentChoice !== "__new"
                        ? opponentChoice
                        : undefined
                    }
                    initialQuery={opponentSearch}
                    onLinked={(saved) => {
                      setOpponents((items) => [
                        ...items.filter((item) => item.id !== saved.id),
                        saved,
                      ]);
                      setOpponentChoice(saved.id);
                      setOpponentSearch(saved.display_name);
                    }}
                  />
                )}
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
              <label>
                Timezone
                <TimezoneSelect
                  required
                  name="timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </label>
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
                <div>
                  <label>
                    Game number (optional)
                    <input
                      name="gameNumber"
                      type="number"
                      min="1"
                      value={gameNumberText}
                      aria-describedby={
                        numberInUse ? "game-number-conflict" : undefined
                      }
                      onChange={(e) => setGameNumberText(e.target.value)}
                      placeholder="Leave blank if not needed"
                      className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                    />
                  </label>
                  {numberInUse && (
                    <p
                      id="game-number-conflict"
                      role="status"
                      className="mt-2 text-amber-300"
                    >
                      Game {gameNumberText} is already used in this event. You
                      can use it again after confirming below.
                    </p>
                  )}
                  {gameNumberText && (
                    <button
                      type="button"
                      className="mt-1 min-h-11 text-cyan-300"
                      onClick={() => {
                        setGameNumberText("");
                        setError("");
                      }}
                    >
                      Leave game unnumbered
                    </button>
                  )}
                </div>
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
              <strong>Streaming</strong>
              <span>
                {youtubeEnabled
                  ? "Yes · reserve an unlisted YouTube watch link"
                  : sharedYoutubeWatchUrl
                    ? "Shared YouTube watch link"
                    : "No · no YouTube event will be created"}
              </span>
            </summary>
            <p className="setup-help">
              Saving with streaming enabled creates a scheduled watch page. It
              does not start a stream.
            </p>
            <div className="setup-grid setup-options-body">
              <fieldset className="md:col-span-2">
                <legend>Stream this game on YouTube?</legend>
                <div className="mt-1 flex gap-4">
                  <label className="min-h-11">
                    <input
                      type="radio"
                      name="youtubeEnabled"
                      checked={youtubeEnabled}
                      onChange={() => {
                        setYoutubeEnabled(true);
                        setSharedYoutubeWatchUrl("");
                        setVisibility("unlisted");
                      }}
                    />{" "}
                    Yes
                  </label>
                  <label className="min-h-11">
                    <input
                      type="radio"
                      name="youtubeEnabled"
                      checked={!youtubeEnabled}
                      onChange={() => setYoutubeEnabled(false)}
                    />{" "}
                    No / shared link
                  </label>
                </div>
              </fieldset>
              <label className="md:col-span-2">
                Shared YouTube watch link (optional)
                <input
                  type="url"
                  name="sharedYoutubeWatchUrl"
                  value={sharedYoutubeWatchUrl}
                  onChange={(event) => {
                    setSharedYoutubeWatchUrl(event.target.value);
                    if (event.target.value.trim()) setYoutubeEnabled(false);
                  }}
                  placeholder="https://youtube.com/watch?v=..."
                  className="mt-1 w-full rounded-lg bg-slate-800 p-3"
                />
                <span className="setup-help">
                  Use an opponent or event organizer’s YouTube watch link. It
                  appears on the game and team pages; CurlStreamer will not
                  create a YouTube event.
                </span>
              </label>
              {youtubeEnabled && (
                <>
                  <label>
                    Broadcast visibility
                    <select
                      name="youtubeVisibility"
                      value={visibility}
                      disabled
                      className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                    >
                      <option value="unlisted">Unlisted</option>
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
                </>
              )}
            </div>
            {youtubeEnabled && (
              <LinkText href="/settings/youtube">
                Manage your team’s YouTube connection →
              </LinkText>
            )}
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
              <dt>Streaming</dt>
              <dd>
                {youtubeEnabled
                  ? "YouTube watch link will be reserved"
                  : sharedYoutubeWatchUrl
                    ? "Shared YouTube watch link"
                    : "No YouTube stream"}
              </dd>
            </div>
            {sharedYoutubeWatchUrl && (
              <div>
                <dt>Shared YouTube link</dt>
                <dd className="break-all">{sharedYoutubeWatchUrl}</dd>
              </div>
            )}
            {youtubeEnabled && (
              <div>
                <dt>YouTube title</dt>
                <dd>{youtubeTitle || "Enter a title in YouTube settings"}</dd>
              </div>
            )}
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
            {busy ? "Saving…" : editing ? "Save changes" : "Schedule game"}
          </button>
          {duplicatePrompt && numberInUse && (
            <div role="alert" className="setup-notice md:col-span-2">
              <p>
                You’ve already used game {gameNumberText} in this event. Use
                this number again?
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    acceptedDuplicate.current = `${eventId}:${gameNumberText}`;
                    setDuplicatePrompt(false);
                    gameForm.current?.requestSubmit();
                  }}
                >
                  Yes, use this number
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setDuplicatePrompt(false);
                    gameForm.current
                      ?.querySelector<HTMLInputElement>('input[type="number"]')
                      ?.focus();
                  }}
                >
                  No, change number
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-red-300 md:col-span-2">
              {error}
            </p>
          )}
          <p className="setup-help">
            {editing
              ? "Your changes update this game’s teams, schedule and settings."
              : "Next: schedule another game or choose where to go."}
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
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      name="showLevel"
                      type="checkbox"
                      defaultChecked
                      className="h-5 w-5"
                    />
                    Show the level in public accomplishments
                  </label>
                  <label>
                    Timezone
                    <TimezoneSelect required name="timezone" />
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
