"use client";
import { useEffect, useId, useRef, useState } from "react";
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
} from "@/lib/team-hierarchy";
import { ROCK_COLOUR_PRESETS } from "@/components/RockColourSelector";
import { DEFAULT_TIMEZONE, TimezoneSelect } from "@/components/TimezoneSelect";
import { OpponentCombobox } from "@/components/OpponentCombobox";
import {
  OpponentDetailsDialog,
  type SavedOpponentDetails,
} from "@/components/OpponentDetailsDialog";
import { nextEventGameNumber } from "@/lib/next-event-game-number";

type Opponent = { id: string; display_name: string };
type Dialog = "season" | "event" | null;
type ScheduleDestination = "games" | "another";
type YouTubeScheduleNotice = {
  id: string;
  destination: ScheduleDestination;
  message: string;
};

class ScheduleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function youtubeSchedulingMessage(code?: string) {
  switch (code) {
    case "youtube_reconnect_required":
    case "youtube_scope_missing":
      return "The connected YouTube channel needs authorization. Reconnect it in YouTube Settings, then retry this game.";
    case "youtube_quota_exceeded":
      return "YouTube's API limit has been reached. The game is saved; retry when the limit resets.";
    case "youtube_live_streaming_not_enabled":
    case "youtube_live_permission_blocked":
      return "YouTube has not enabled live streaming for this channel. Check the channel in YouTube Studio before retrying.";
    case "broadcast_operation_uncertain":
    case "broadcast_discovery_incomplete":
      return "We could not confirm whether YouTube created a watch page. Check this channel's Live list in YouTube Studio before retrying; do not schedule a duplicate game.";
    case "youtube_provider_unavailable":
      return "YouTube did not respond. The game is saved; try again shortly.";
    default:
      return "The game was saved, but its YouTube watch page is still pending.";
  }
}

function getYouTubeScheduleNotice(youtube?: {
  status?: string;
  thumbnailStatus?: string;
  errorCode?: string;
}) {
  if (youtube?.status !== "ready")
    return youtubeSchedulingMessage(youtube?.errorCode);
  if (youtube.thumbnailStatus === "pending")
    return "Your watch link is ready, but YouTube could not accept its preview image.";
}

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
  canManageTeamDetails = true,
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
  canManageTeamDetails?: boolean;
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
    editing
      ? (editing.gameNumber?.toString() ?? "")
      : nextEventGameNumber(preselected?.id ?? "", games),
  );
  const gameForm = useRef<HTMLFormElement>(null);
  const gameNumberInput = useRef<HTMLInputElement>(null);
  const duplicateSubmitter = useRef<HTMLButtonElement | undefined>(undefined);
  const acceptedDuplicate = useRef("");
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const [showGameNumber, setShowGameNumber] = useState(false);
  useEffect(() => {
    if (showGameNumber) gameNumberInput.current?.focus();
  }, [showGameNumber]);
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
    editing ? (editing.opponentId ?? "__tbd") : "__tbd",
  );
  const [opponentSearch, setOpponentSearch] = useState(
    editing?.opponentId
      ? (opponents.find((o) => o.id === editing.opponentId)?.display_name ??
          editing.config.awayName)
      : "",
  );
  const opponentTbd = opponentChoice === "__tbd";
  const validOpponent =
    opponentTbd ||
    Boolean(
      opponentChoice &&
      (opponents.some((opponent) => opponent.id === opponentChoice) ||
        editing?.opponentId === opponentChoice),
    );
  const [opponentDialog, setOpponentDialog] = useState(false);
  const selectedOpponent =
    opponents.find((opponent) => opponent.id === opponentChoice) ??
    (editing?.opponentId === opponentChoice
      ? { id: opponentChoice, display_name: editing.config.awayName }
      : undefined);
  const [dialog, setDialog] = useState<Dialog>(
    !current && canManageTeamDetails ? "season" : null,
  );
  const [eventSeasonId, setEventSeasonId] = useState(seasonId);
  const continueToEvent = useRef(false);
  const setupDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog) return;
    const element = setupDialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [dialog]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  // Keeping this key for the form lifetime makes a client-side retry after a
  // lost response idempotent; the server never creates a second game.
  const creationGameId = useRef(
    typeof crypto === "undefined" ? "" : crypto.randomUUID(),
  );
  const [chooseColours, setChooseColours] = useState(true);
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
  const visibilityLocked = Boolean(
    editing &&
    (editing.scheduledYouTubeWatchUrl ||
      editing.scheduledYouTubeStatus === "intent" ||
      editing.scheduledYouTubeStatus === "ready"),
  );
  const [youtubeEnabled, setYoutubeEnabled] = useState(
    editing?.config.youtubeEnabled ?? false,
  );
  const [sharedYoutubeWatchUrl, setSharedYoutubeWatchUrl] = useState(
    editing?.config.sharedYoutubeWatchUrl ?? "",
  );
  const [youtubeNotice, setYouTubeNotice] = useState<YouTubeScheduleNotice>();
  const [schedulingMessage, setSchedulingMessage] = useState("");
  const [error, setError] = useState("");
  const [scheduledDate, setScheduledDate] = useState(
    initialSchedule?.date ?? "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    initialSchedule?.time ?? "",
  );
  const [timezone, setTimezone] = useState(initialTimezone);
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
  const homeTeamName = editing?.config.homeName ?? teamName;
  const effectiveTimezone = timezone;
  const canonicalTitle = formatCanonicalGameTitle({
    homeName: homeTeamName,
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
  function chooseEvent(value: string) {
    setEventId(value);
    setGameNumberText(
      editing && value === editing.eventId
        ? (editing.gameNumber?.toString() ?? "")
        : nextEventGameNumber(value, games, newGameNumbers),
    );
    acceptedDuplicate.current = "";
    setDuplicatePrompt(false);
    setShowGameNumber(false);
  }
  function openEventDialog() {
    setError("");
    setEventSeasonId(seasonId);
    if (!seasonId) {
      continueToEvent.current = true;
      setDialog("season");
    } else setDialog("event");
  }
  function opponentSaved(saved: SavedOpponentDetails) {
    setOpponents((items) => [
      ...items.filter((item) => item.id !== saved.id),
      { id: saved.id, display_name: saved.display_name },
    ]);
    setOpponentChoice(saved.id);
    setOpponentSearch(saved.display_name);
    setOpponentDialog(false);
  }
  function chooseSeason(value: string) {
    if (value === "__new") return setDialog("season");
    setSeasonId(value);
    if (!events.some((e) => e.id === eventId && e.seasonId === value))
      chooseEvent("");
  }
  async function mutate(payload: unknown) {
    const response = await fetch("/api/team-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new ScheduleRequestError(
        body?.error ?? "The change could not be saved.",
        response.status,
      );
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
      chooseEvent("");
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
      if (continueToEvent.current) {
        continueToEvent.current = false;
        setEventSeasonId(id);
        setDialog("event");
      } else setDialog(null);
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
        seasonId: eventSeasonId,
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
      setSeasonId(eventSeasonId);
      chooseEvent(id);
      setTimezone(String(input.timezone));
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Event could not be created.");
    } finally {
      setBusy(false);
    }
  }
  function finishScheduling(
    destination: ScheduleDestination,
    savedGameNumber?: string,
  ) {
    if (destination === "games") {
      router.replace(`/dashboard?season=${encodeURIComponent(seasonId)}`);
      router.refresh();
      return;
    }
    creationGameId.current = crypto.randomUUID();
    acceptedDuplicate.current = "";
    setShowGameNumber(false);
    setYouTubeNotice(undefined);
    setScheduledTime("");
    setGameNumberText(
      nextEventGameNumber(eventId, games, [
        ...newGameNumbers,
        ...(savedGameNumber ? [savedGameNumber] : []),
      ]),
    );
    setTitleCustomized(false);
    setError("");
    setSchedulingMessage("Game scheduled.");
    setBusy(false);
    saving.current = false;
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving.current) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const destination =
      submitter instanceof HTMLButtonElement && submitter.value === "another"
        ? "another"
        : "games";
    if (youtubeNotice) {
      saving.current = true;
      setBusy(true);
      finishScheduling(destination);
      return;
    }
    if (!validOpponent) {
      setError("Choose a matching opponent or create a new opponent.");
      return;
    }
    const trimmedTitle = youtubeTitle.trim();
    if (
      youtubeEnabled &&
      (trimmedTitle.length < 2 || trimmedTitle.length > 100)
    ) {
      setError("Enter a YouTube title between 2 and 100 characters.");
      return;
    }
    if (
      numberInUse &&
      acceptedDuplicate.current !== `${eventId}:${gameNumberText}`
    ) {
      duplicateSubmitter.current =
        submitter instanceof HTMLButtonElement ? submitter : undefined;
      setDuplicatePrompt(true);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setSchedulingMessage("");
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
        ...(opponentTbd ? {} : { opponentId: opponentChoice }),
        scheduledDate: date,
        scheduledTime: form.get("scheduledTime"),
        timezone,
        gameNumber,
        config: {
          eventName: formatEventGameLabel(
            selectedEvent?.name ?? "Single Game",
            gameNumber,
          ),
          homeName: homeTeamName,
          awayName: opponentTbd ? "Opponent TBD" : opponentName,
          homeColor,
          awayColor,
          scheduledEnds: ends,
          youtubeEnabled,
          sharedYoutubeWatchUrl: youtubeEnabled ? "" : sharedYoutubeWatchUrl,
          youtubeTitle: youtubeEnabled
            ? trimmedTitle
            : (trimmedTitle.length >= 2 ? trimmedTitle : generatedTitle).slice(
                0,
                100,
              ),
          youtubeVisibility: visibility,
        },
      });
      if (!editing) {
        const savedGameNumber =
          eventId && gameNumberText
            ? `${eventId}:${gameNumberText}`
            : undefined;
        if (savedGameNumber)
          setNewGameNumbers((numbers) => [...numbers, savedGameNumber]);
        if (onCreated) {
          onCreated(body.game.id);
          setBusy(false);
          saving.current = false;
          return;
        }
        const message = youtubeEnabled
          ? getYouTubeScheduleNotice(body.youtube)
          : undefined;
        if (message) {
          setYouTubeNotice({ id: body.game.id, destination, message });
          setBusy(false);
          saving.current = false;
        } else finishScheduling(destination, savedGameNumber);
        return;
      }
      if (editing && body.youtube?.status === "pending") {
        setError(
          "The game was saved, but YouTube’s broadcast details could not be updated. Please save changes again to retry.",
        );
        setBusy(false);
        saving.current = false;
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      if (
        e instanceof ScheduleRequestError &&
        e.status === 409 &&
        e.message.includes("game number is already used")
      ) {
        setShowGameNumber(true);
        setDuplicatePrompt(false);
      }
      setError(e instanceof Error ? e.message : "Game could not be saved.");
      setBusy(false);
      saving.current = false;
    }
  }
  async function retryYouTube() {
    if (!youtubeNotice || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const body = await mutate({
        operation: "retryYouTube",
        gameId: youtubeNotice.id,
      });
      const message = getYouTubeScheduleNotice(body.youtube);
      if (!message) {
        finishScheduling(youtubeNotice.destination);
        return;
      }
      setYouTubeNotice({ ...youtubeNotice, message });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "YouTube could not be reached.",
      );
    }
    setBusy(false);
    saving.current = false;
  }
  const scheduleDisabled =
    busy || !seasonId || !scheduledInstant || !validOpponent;
  return (
    <>
      <header className="setup-heading">
        <h1>{editing ? "Edit game" : "Schedule game"}</h1>
      </header>
      <form
        ref={gameForm}
        onSubmit={submit}
        className="setup-form"
        aria-busy={busy}
      >
        <fieldset disabled={busy || !!youtubeNotice} className="setup-fields">
          <div className="setup-grid">
            <label className="setup-field">
              Season
              <select
                required
                value={seasonId}
                onChange={(event) => chooseSeason(event.target.value)}
              >
                <option value="" disabled>
                  Select a season
                </option>
                {seasons
                  .filter((season) => season.status !== "archived")
                  .map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                      {season.status === "active" ? " (Current)" : ""}
                    </option>
                  ))}
                {canManageTeamDetails && (
                  <option value="__new">Create New Season…</option>
                )}
              </select>
            </label>
            <div className="setup-field">
              <label htmlFor="setup-event">Event</label>
              <div className="setup-field-action">
                <select
                  id="setup-event"
                  disabled={!seasonId}
                  value={eventId}
                  onChange={(event) => chooseEvent(event.target.value)}
                >
                  <option value="">Single Game</option>
                  {availableEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
                {canManageTeamDetails && (
                  <button
                    type="button"
                    className="setup-add"
                    aria-label="Create event"
                    onClick={openEventDialog}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                )}
              </div>
            </div>
            <label className="setup-field">
              Date
              <input
                required
                name="scheduledDate"
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
                min={selectedEvent?.startDate}
                max={selectedEvent?.endDate}
              />
            </label>
            <label className="setup-field">
              Time
              <input
                required
                name="scheduledTime"
                type="time"
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
              />
            </label>
            <label className="setup-field">
              Team
              <input readOnly value={homeTeamName} />
            </label>
            <div className="setup-field">
              <label htmlFor="setup-opponent">Opponent</label>
              <div className="setup-field-action">
                <OpponentCombobox
                  id="setup-opponent"
                  options={
                    selectedOpponent &&
                    !opponents.some(
                      (opponent) => opponent.id === selectedOpponent.id,
                    )
                      ? [...opponents, selectedOpponent]
                      : opponents
                  }
                  value={opponentChoice}
                  displayName={opponentSearch}
                  disabled={busy}
                  showDropdown
                  onSelect={(choice, name) => {
                    setOpponentChoice(choice);
                    setOpponentSearch(name);
                    setError("");
                  }}
                />
                <button
                  type="button"
                  className="setup-add"
                  aria-label="Create new opponent"
                  disabled={!seasonId}
                  onClick={() => setOpponentDialog(true)}
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
            </div>
            <label className="setup-field">
              Timezone
              <TimezoneSelect
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <label className="setup-field">
              Ends
              <select
                name="scheduledEnds"
                value={ends}
                disabled={Boolean(editing)}
                onChange={(event) =>
                  setEnds(Number(event.target.value) as 8 | 10)
                }
              >
                <option value="8">8 ends</option>
                <option value="10">10 ends</option>
              </select>
            </label>
            {eventId && (editing || showGameNumber) && (
              <label className="setup-field">
                Game number (optional)
                <input
                  ref={gameNumberInput}
                  name="gameNumber"
                  type="number"
                  min="1"
                  value={gameNumberText}
                  onChange={(event) => {
                    acceptedDuplicate.current = "";
                    setDuplicatePrompt(false);
                    setError("");
                    setGameNumberText(event.target.value);
                  }}
                />
              </label>
            )}
          </div>
          {invalidSchedule && (
            <p role="alert" className="setup-error">
              That local date and time is not valid in {effectiveTimezone}.
              Times skipped when clocks move forward cannot be scheduled.
            </p>
          )}
          <section
            className="setup-section"
            aria-labelledby="setup-rock-colours"
          >
            <div className="setup-section-heading setup-rock-heading">
              <h2 id="setup-rock-colours">Rock colours</h2>
              <SetupSwitch
                name="Choose now"
                stateText={chooseColours ? "Choose now" : "Choose later"}
                checked={chooseColours}
                onChange={setChooseColours}
              />
            </div>
            {chooseColours && (
              <div className="setup-palettes">
                <SetupPalette
                  label={homeTeamName}
                  value={homeColor}
                  onChange={setHomeColor}
                  disabled={Boolean(editing)}
                />
                <SetupPalette
                  label="Opponent"
                  value={awayColor}
                  onChange={setAwayColor}
                  disabled={Boolean(editing)}
                />
              </div>
            )}
          </section>
          <section className="setup-section" aria-labelledby="setup-youtube">
            <div className="setup-section-heading">
              <h2 id="setup-youtube">YouTube streaming</h2>
              <SetupSwitch
                name="YouTube streaming"
                stateText={youtubeEnabled ? "On" : "Off"}
                checked={youtubeEnabled}
                onChange={setYoutubeEnabled}
              />
            </div>
            {youtubeEnabled ? (
              <>
                <div className="setup-youtube-fields">
                  <div className="setup-field setup-visibility">
                    {editing?.config.youtubeVisibility === "private" ? (
                      <label className="setup-field">
                        Broadcast visibility
                        <select
                          value={visibility}
                          disabled={visibilityLocked}
                          aria-describedby={
                            visibilityLocked
                              ? "setup-visibility-lock"
                              : undefined
                          }
                          onChange={(event) =>
                            setVisibility(
                              event.target.value as typeof visibility,
                            )
                          }
                        >
                          <option value="unlisted">Unlisted</option>
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                      </label>
                    ) : (
                      <>
                        <span>Broadcast visibility</span>
                        <span id="setup-visibility-options" className="sr-only">
                          Off is Unlisted. On is Public.
                        </span>
                        <SetupSwitch
                          name="Broadcast visibility"
                          stateText={
                            visibility === "public" ? "Public" : "Unlisted"
                          }
                          checked={visibility === "public"}
                          disabled={visibilityLocked}
                          describedBy={
                            visibilityLocked
                              ? "setup-visibility-options setup-visibility-lock"
                              : "setup-visibility-options"
                          }
                          onChange={(checked) =>
                            setVisibility(checked ? "public" : "unlisted")
                          }
                        />
                      </>
                    )}
                    {visibilityLocked && (
                      <p id="setup-visibility-lock" className="setup-help">
                        Visibility is fixed once the YouTube watch page
                        reservation begins.
                      </p>
                    )}
                  </div>
                  <label className="setup-field">
                    YouTube title
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      name="youtubeTitle"
                      value={youtubeTitle}
                      onChange={(event) => {
                        setCustomTitle(event.target.value);
                        setTitleCustomized(true);
                      }}
                    />
                  </label>
                </div>
                <a href="/settings/youtube" className="setup-youtube-link">
                  Manage YouTube connection <span aria-hidden="true">→</span>
                </a>
              </>
            ) : (
              <label className="setup-field setup-shared-link">
                Paste the YouTube link
                <input
                  type="url"
                  name="sharedYoutubeWatchUrl"
                  value={sharedYoutubeWatchUrl}
                  onChange={(event) =>
                    setSharedYoutubeWatchUrl(event.target.value)
                  }
                  placeholder="https://youtube.com/watch?v=..."
                />
              </label>
            )}
          </section>
        </fieldset>
        <div className="setup-section setup-actions">
          {duplicatePrompt && numberInUse && (
            <div role="alert" className="setup-notice">
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
                    gameForm.current?.requestSubmit(duplicateSubmitter.current);
                  }}
                >
                  Yes, use this number
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setDuplicatePrompt(false);
                    if (editing || showGameNumber)
                      gameNumberInput.current?.focus();
                    else setShowGameNumber(true);
                  }}
                >
                  No, change number
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="setup-error">
              {error}
            </p>
          )}
          {youtubeNotice && (
            <div className="setup-notice setup-youtube-notice">
              <p role="status">{youtubeNotice.message}</p>
              <p className="mt-1">You can retry YouTube or continue.</p>
              <button
                type="button"
                className="btn-secondary mt-2"
                disabled={busy}
                onClick={retryYouTube}
              >
                Retry YouTube
              </button>
            </div>
          )}
          <button
            type="submit"
            value="games"
            disabled={scheduleDisabled}
            className="btn setup-submit"
          >
            {editing ? "Save changes" : "Schedule"}
          </button>
          {!editing && !onCreated && (
            <button
              type="submit"
              value="another"
              className="btn-secondary setup-submit-another"
              disabled={scheduleDisabled}
            >
              Schedule and Create Another
            </button>
          )}
          <span className="sr-only" role="status">
            {busy ? "Saving…" : schedulingMessage}
          </span>
        </div>
      </form>
      {opponentDialog && (
        <OpponentDetailsDialog
          mode="create"
          initialName={opponentChoice === "" ? opponentSearch : ""}
          canManageSeasonDetails={canManageTeamDetails}
          seasonId={seasonId}
          seasonName={
            seasons.find((season) => season.id === seasonId)?.name ??
            "Selected season"
          }
          onSaved={opponentSaved}
          onCancel={() => setOpponentDialog(false)}
        />
      )}
      {dialog && (
        <dialog
          key={dialog}
          ref={setupDialog}
          aria-labelledby="inline-heading"
          className="panel fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto backdrop:bg-black/70"
          onCancel={(event) => {
            if (busy || !seasons.some((season) => season.status !== "archived"))
              event.preventDefault();
            else {
              continueToEvent.current = false;
              setError("");
              setDialog(null);
            }
          }}
        >
          <h2 id="inline-heading" className="text-2xl font-bold">
            Create New {dialog === "season" ? "Season" : "Event"}
          </h2>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const form = new FormData(event.currentTarget);
              void (dialog === "season"
                ? createSeason(form)
                : createEvent(form));
            }}
          >
            <fieldset disabled={busy} className="grid min-w-0 gap-3">
              {dialog === "event" && (
                <label>
                  Season
                  <select
                    required
                    name="seasonId"
                    value={eventSeasonId}
                    onChange={(event) => setEventSeasonId(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
                  >
                    {seasons
                      .filter((season) => season.status !== "archived")
                      .map((season) => (
                        <option key={season.id} value={season.id}>
                          {season.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
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
                  {busy
                    ? "Creating…"
                    : dialog === "event"
                      ? "Create event"
                      : "Create season"}
                </button>
                {seasons.some((season) => season.status !== "archived") && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      continueToEvent.current = false;
                      setError("");
                      setDialog(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="text-red-300">
                {error}
              </p>
            )}
          </form>
        </dialog>
      )}
    </>
  );
}
function SetupSwitch({
  name,
  stateText,
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  name: string;
  stateText: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="setup-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={name}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="setup-switch-track" aria-hidden="true" />
      <span aria-hidden="true">{stateText}</span>
    </label>
  );
}

function SetupPalette({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const colors = ROCK_COLOUR_PRESETS.some(
    (preset) => preset.value === value.toLowerCase(),
  )
    ? ROCK_COLOUR_PRESETS
    : [...ROCK_COLOUR_PRESETS, { name: "Custom", value }];

  return (
    <div className="setup-palette" role="radiogroup" aria-labelledby={id}>
      <p id={id}>{label}</p>
      <div className="setup-swatches">
        {colors.map((color) => {
          const selected = color.value.toLowerCase() === value.toLowerCase();
          return (
            <label
              key={color.value}
              className="setup-swatch"
              title={`${label}: ${color.name}`}
            >
              <input
                type="radio"
                name={`${id}-choice`}
                value={color.value}
                aria-label={`${label}: ${color.name}`}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(color.value)}
              />
              <span style={{ backgroundColor: color.value }} aria-hidden="true">
                {selected && "✓"}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
