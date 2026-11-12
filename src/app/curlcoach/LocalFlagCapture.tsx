"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { captureShotFlagClip } from "@/lib/curlcoach/shot-flag-clip";
import EntryOverlay from "./EntryOverlay";
import FlagScrubSlider, { flagNudgeSeconds } from "./FlagScrubSlider";

type Audience = "" | "team" | "player";
type Clip = Awaited<ReturnType<typeof captureShotFlagClip>> & { url: string };
type StartPoint = { time: number; selectedAt: string; capturedAt: string };
type SeekWindow = { first: number; last: number; duration: number };
type FirstFrame = {
  url: string;
  window?: SeekWindow;
  seekStarted: boolean;
  preferFirst?: boolean;
  fallback?: number;
};
type FlagSaveResult = "none" | "saved" | "failed";
export type LocalFlagHandle = {
  saveSelectedFlag: () => Promise<FlagSaveResult>;
};
const captureTimeoutMs = 75_000;
const firstSeekTimeoutMs = 1_500;
const fineScrubSeconds = 20;
const videoError = "Video could not play. Reload recent video to try again.";

export default function LocalFlagCapture({
  gameId,
  players,
  defaultPlayerId,
  onSaved,
  ref,
}: {
  gameId: string;
  players: readonly { id: string; name: string }[];
  defaultPlayerId: string;
  onSaved: () => void;
  ref?: Ref<LocalFlagHandle>;
}) {
  const [flagging, setFlagging] = useState(false);
  const [audience, setAudience] = useState<Audience>("");
  const [playerId, setPlayerId] = useState("");
  const [note, setNote] = useState("");
  const [clip, setClip] = useState<Clip | null>(null);
  const [start, setStart] = useState<StartPoint | null>(null);
  const [time, setTime] = useState(0);
  const [seekWindow, setSeekWindow] = useState<SeekWindow | null>(null);
  const [fullClip, setFullClip] = useState(false);
  const [fineStart, setFineStart] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState<"loading" | "retrying" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [startingVideo, setStartingVideo] = useState(false);
  const [tapToLoad, setTapToLoad] = useState(false);
  const [clipError, setClipError] = useState("");
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const clipUrl = useRef<string | null>(null);
  const selectedClipUrl = useRef<string | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const firstFrame = useRef<FirstFrame | null>(null);
  const captureRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<{
    controller: AbortController;
    result: Promise<FlagSaveResult>;
  } | null>(null);
  const payload = useRef<string | null>(null);
  const player = players.find((member) => member.id === playerId);
  const canPick = audience === "team" || (audience === "player" && !!player);
  const canSave = locked || canPick;
  const canZoom =
    seekWindow && seekWindow.last - seekWindow.first > fineScrubSeconds;
  const sliderFirst = seekWindow
    ? fullClip || !canZoom
      ? seekWindow.first
      : (fineStart ?? seekWindow.last - fineScrubSeconds)
    : 0;
  const sliderLast = seekWindow
    ? fullClip || !canZoom
      ? seekWindow.last
      : Math.min(seekWindow.last, sliderFirst + fineScrubSeconds)
    : 0;
  const secondsBack = seekWindow ? Math.max(0, seekWindow.last - time) : 0;
  const seekLabel =
    secondsBack < 0.005
      ? "Newest frame"
      : `${secondsBack.toFixed(2)} seconds back`;

  useEffect(
    () => () => {
      captureRequest.current?.abort();
      saveRequest.current?.controller.abort();
      window.clearTimeout(firstFrame.current?.fallback);
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    },
    [],
  );

  useEffect(() => {
    const element = video.current;
    if (
      !pickerOpen ||
      !element ||
      !clip ||
      firstFrame.current?.url !== clip.url
    )
      return;
    // Safari may defer a paused video's preload. Muted inline playback asks it
    // to decode, and the first decoded frame is paused before the initial seek.
    const showTap = () => {
      if (firstFrame.current?.url === clip.url) setTapToLoad(true);
    };
    const timer = window.setTimeout(showTap, 1_000);
    void element.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotAllowedError")
        showTap();
    });
    return () => window.clearTimeout(timer);
  }, [clip, pickerOpen]);

  function movePlayhead(target: number, available: SeekWindow) {
    setTime(target);
    const latestStart = Math.max(
      available.first,
      available.last - fineScrubSeconds,
    );
    setFineStart((previous) => {
      const first = previous ?? latestStart;
      if (target >= first && target <= first + fineScrubSeconds)
        return previous;
      return Math.max(
        available.first,
        Math.min(latestStart, target - fineScrubSeconds / 2),
      );
    });
  }

  function flushSeek() {
    const element = video.current;
    if (!element || element.src !== clipUrl.current || element.seeking) return;
    const ready = element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const initial = firstFrame.current;
    if (initial) {
      if (!pickerOpen || !ready || !initial.window) return;
      element.pause();
      if (!initial.seekStarted) {
        initial.seekStarted = true;
        const target = initial.preferFirst
          ? initial.window.first
          : initial.window.last;
        if (Math.abs(element.currentTime - target) > 0.001) {
          element.currentTime = target;
          if (!initial.preferFirst)
            initial.fallback = window.setTimeout(() => {
              if (firstFrame.current !== initial || !initial.window) return;
              // Keep the downloaded clip if the near-end seek stalls.
              element.currentTime = initial.window.first;
              flushSeek();
            }, firstSeekTimeoutMs);
          return;
        }
      }
      window.clearTimeout(initial.fallback);
      firstFrame.current = null;
      movePlayhead(element.currentTime, initial.window);
      setStartingVideo(false);
      setTapToLoad(false);
    }
    if (pendingSeek.current !== null) {
      const target = pendingSeek.current;
      pendingSeek.current = null;
      if (Math.abs(element.currentTime - target) > 0.001) {
        element.currentTime = target;
        return;
      }
    }
    setSettled(ready);
  }

  function seek(seconds: number, available = seekWindow) {
    if (!available || !video.current) return;
    const target = Math.max(available.first, Math.min(available.last, seconds));
    video.current.pause();
    movePlayhead(target, available);
    setSettled(false);
    pendingSeek.current = target;
    flushSeek();
  }

  function clearClip() {
    const url = clipUrl.current;
    clipUrl.current = null;
    window.clearTimeout(firstFrame.current?.fallback);
    firstFrame.current = null;
    if (url) URL.revokeObjectURL(url);
    setStartingVideo(false);
    setTapToLoad(false);
    setSeekWindow(null);
    setFullClip(false);
    setFineStart(null);
    setSettled(false);
    setPlaying(false);
    pendingSeek.current = null;
    setClip(null);
  }

  function showClip(captured: Omit<Clip, "url">) {
    const url = URL.createObjectURL(captured.video);
    clipUrl.current = url;
    firstFrame.current = { url, seekStarted: false };
    setStartingVideo(true);
    setClip({ ...captured, url });
  }

  async function capture() {
    if (captureRequest.current) return;
    const controller = new AbortController();
    captureRequest.current = controller;
    setLoading("loading");
    setClipError("");
    clearClip();
    const deadline = window.setTimeout(() => {
      if (captureRequest.current !== controller) return;
      cancelCapture();
      clearClip();
      setClipError("Recent video took too long to load.");
    }, captureTimeoutMs);
    controller.signal.addEventListener(
      "abort",
      () => window.clearTimeout(deadline),
      { once: true },
    );
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const captured = await captureShotFlagClip(gameId, controller.signal);
          controller.signal.throwIfAborted();
          showClip(captured);
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          clearClip();
          if (attempt === 0) setLoading("retrying");
          else
            setClipError(
              error instanceof Error
                ? error.message
                : "Could not load recent video.",
            );
        }
      }
    } finally {
      window.clearTimeout(deadline);
      if (captureRequest.current === controller) {
        captureRequest.current = null;
        setLoading(null);
      }
    }
  }

  function cancelCapture() {
    captureRequest.current?.abort();
    captureRequest.current = null;
    setLoading(null);
  }

  function closePicker() {
    setPickerOpen(false);
    cancelCapture();
    video.current?.pause();
    if (selectedClipUrl.current !== clipUrl.current) clearClip();
  }

  function failVideo(element: HTMLVideoElement) {
    if (element !== video.current || element.src !== clipUrl.current) return;
    clearClip();
    setClipError(videoError);
  }

  function chooseStart() {
    const element = video.current;
    if (
      !clip ||
      !seekWindow ||
      !element ||
      loading ||
      startingVideo ||
      !settled ||
      element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      element.seeking ||
      !element.paused ||
      pendingSeek.current !== null
    )
      return false;
    const selected = Math.max(
      seekWindow.first,
      Math.min(seekWindow.last, time),
    );
    selectedClipUrl.current = clip.url;
    setStart({
      time: selected,
      selectedAt: new Date(
        Date.parse(clip.capturedAt) - (seekWindow.duration - selected) * 1000,
      ).toISOString(),
      capturedAt: clip.capturedAt,
    });
  }

  function resetFlag() {
    setFlagging(false);
    setAudience("");
    setPlayerId("");
    cancelCapture();
    clearClip();
    selectedClipUrl.current = null;
    setStart(null);
    setNote("");
    setLocked(false);
    payload.current = null;
  }

  function saveSelectedFlag(): Promise<FlagSaveResult> {
    if (saveRequest.current) return saveRequest.current.result;
    if (!start) return Promise.resolve("none");
    if (!audience || !canSave) {
      setStatus("Choose who the flag is for before saving it.");
      return Promise.resolve("failed");
    }
    const controller = new AbortController();
    setSaving(true);
    setLocked(true);
    setStatus("Saving flag…");
    payload.current ??= JSON.stringify({
      review: {
        version: 1,
        id: crypto.randomUUID(),
        gameId,
        audience,
        notes: note,
        selectedAt: start.selectedAt,
        capturedAt: start.capturedAt,
        timingEstimated: true,
      },
      shotId: null,
      ...(audience === "player" ? { playerId } : {}),
      expectedRevision: 0,
    });
    const result = submitFlag(payload.current, controller);
    saveRequest.current = { controller, result };
    return result;
  }

  async function submitFlag(
    body: string,
    controller: AbortController,
  ): Promise<FlagSaveResult> {
    try {
      const response = await fetch("/api/curlcoach/local-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      const receipt = await response.json().catch(() => null);
      if (controller.signal.aborted) return "failed";
      if (!response.ok || receipt?.saved !== true)
        throw Error("Could not save the flag. Try saving it again.");
      resetFlag();
      setStatus(
        `Flag saved for ${audience === "team" ? "the team" : player?.name}. Find it in Flagged shots.`,
      );
      onSaved();
      return "saved";
    } catch {
      if (!controller.signal.aborted)
        setStatus("Could not save the flag. Your selection and note are kept.");
      return "failed";
    } finally {
      if (saveRequest.current?.controller === controller) {
        saveRequest.current = null;
        if (!controller.signal.aborted) setSaving(false);
      }
    }
  }
  useImperativeHandle(ref, () => ({ saveSelectedFlag }));

  return (
    <section
      className="shot-flag-entry"
      aria-label="Video flag"
      data-standalone-flag
    >
      <label>
        Flag shot for review
        <select
          value={flagging ? "yes" : "no"}
          disabled={locked}
          onChange={(event) => {
            setStatus("");
            if (event.target.value === "yes") {
              setFlagging(true);
              void capture();
              setPlayerId(
                players.some((member) => member.id === defaultPlayerId)
                  ? defaultPlayerId
                  : "",
              );
            } else {
              resetFlag();
            }
          }}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      {flagging && (
        <>
          <div className="coach-entry-grid">
            <label>
              Flag audience
              <select
                value={audience}
                disabled={locked}
                onChange={(event) =>
                  setAudience(event.target.value as Audience)
                }
              >
                <option value="">Choose an audience</option>
                <option value="team">Team</option>
                <option value="player">Player</option>
              </select>
            </label>
            {audience === "player" && (
              <label>
                Player
                <select
                  value={playerId}
                  disabled={locked}
                  onChange={(event) => setPlayerId(event.target.value)}
                >
                  <option value="">Choose a player</option>
                  {players.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div hidden={!canPick || locked}>
            <EntryOverlay
              title="Select Flag Start"
              doneLabel="Choose Start Point"
              doneDisabled={
                !!loading ||
                startingVideo ||
                !seekWindow ||
                !settled ||
                playing ||
                !!clipError
              }
              onOpen={() => {
                setPickerOpen(true);
                if (!clip && !clipError) void capture();
                else if (start && clip && selectedClipUrl.current === clip.url)
                  seek(start.time);
              }}
              onDone={chooseStart}
              onClose={closePicker}
            >
              {loading && (
                <p role="status">
                  {loading === "loading"
                    ? "Loading recent video…"
                    : "Retrying recent video…"}
                </p>
              )}
              {startingVideo && !loading && (
                <p role="status">Opening recent video…</p>
              )}
              {tapToLoad && startingVideo && (
                <button
                  type="button"
                  onClick={() => {
                    const element = video.current;
                    const initial = firstFrame.current;
                    if (!element || !initial) return;
                    window.clearTimeout(initial.fallback);
                    initial.preferFirst ||= initial.seekStarted;
                    initial.seekStarted = false;
                    initial.window = undefined;
                    element.load();
                    void element.play().catch(() => undefined);
                  }}
                >
                  Tap to load video
                </button>
              )}
              {clipError && <p role="alert">{clipError}</p>}
              {clip && !clipError && (
                <>
                  <video
                    key={clip.url}
                    className="shot-flag-video"
                    ref={video}
                    src={clip.url}
                    playsInline
                    muted
                    preload={pickerOpen ? "auto" : "none"}
                    onLoadedMetadata={({ currentTarget }) => {
                      const initial = firstFrame.current;
                      if (!initial || initial.url !== currentTarget.src) return;
                      const mediaDuration = currentTarget.duration;
                      const duration =
                        Number.isFinite(mediaDuration) && mediaDuration > 0
                          ? Math.min(mediaDuration, clip.duration)
                          : clip.duration;
                      // Leave room for the video track to end before the audio.
                      const last = Math.max(0, duration - 0.5);
                      const first = Math.min(clip.minimum, last);
                      const available = { first, last, duration };
                      initial.window = available;
                      setSeekWindow(available);
                      flushSeek();
                    }}
                    onLoadedData={flushSeek}
                    onCanPlay={flushSeek}
                    onPlaying={flushSeek}
                    onSeeking={() => setSettled(false)}
                    onSeeked={flushSeek}
                    onPlay={() => {
                      if (!firstFrame.current) setPlaying(true);
                    }}
                    onPause={() => {
                      setPlaying(false);
                      flushSeek();
                    }}
                    onTimeUpdate={({ currentTarget }) => {
                      if (
                        !startingVideo &&
                        pendingSeek.current === null &&
                        currentTarget === video.current &&
                        !currentTarget.paused &&
                        !currentTarget.seeking &&
                        seekWindow
                      ) {
                        const current = currentTarget.currentTime;
                        if (current > seekWindow.last) seek(seekWindow.last);
                        else movePlayhead(current, seekWindow);
                      }
                    }}
                    onError={({ currentTarget }) => failVideo(currentTarget)}
                  />
                  {!loading && !startingVideo && seekWindow && (
                    <div className="shot-flag-timeline">
                      <div className="shot-flag-timeline-header">
                        <div>
                          <div>Shot start · {seekLabel}</div>
                          {canZoom && !fullClip && (
                            <small>20-second view</small>
                          )}
                        </div>
                        {canZoom && (
                          <button
                            type="button"
                            onClick={() => setFullClip(!fullClip)}
                          >
                            {fullClip ? "Fine scrub" : "Full clip"}
                          </button>
                        )}
                      </div>
                      <FlagScrubSlider
                        first={sliderFirst}
                        last={sliderLast}
                        time={time}
                        description={seekLabel}
                        onSeek={seek}
                      />
                    </div>
                  )}
                  <div className="shot-flag-playback">
                    <button
                      type="button"
                      aria-label="−0.25 seconds"
                      disabled={!!loading || startingVideo || !seekWindow}
                      onClick={() => seek(time - flagNudgeSeconds)}
                    >
                      −0.25 s
                    </button>
                    <button
                      type="button"
                      disabled={
                        !!loading ||
                        startingVideo ||
                        !seekWindow ||
                        (!playing && !settled)
                      }
                      onClick={() => {
                        const element = video.current;
                        if (!element) return;
                        if (playing) seek(element.currentTime);
                        else
                          void element.play().catch((error: unknown) => {
                            if (!(
                              error instanceof DOMException &&
                              error.name === "AbortError"
                            ))
                              failVideo(element);
                          });
                      }}
                    >
                      {playing ? "Pause" : "Play"}
                    </button>
                    <button
                      type="button"
                      aria-label="+0.25 seconds"
                      disabled={!!loading || startingVideo || !seekWindow}
                      onClick={() => seek(time + flagNudgeSeconds)}
                    >
                      +0.25 s
                    </button>
                  </div>
                </>
              )}
              <button
                type="button"
                disabled={!!loading}
                onClick={() => void capture()}
              >
                Reload recent video
              </button>
            </EntryOverlay>
          </div>
          {start && (
            <>
              <p>Start point selected. Save Flag or use Next Turn.</p>
              <label>
                Flag note (optional)
                <textarea
                  maxLength={2000}
                  rows={3}
                  value={note}
                  disabled={locked}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary"
                disabled={!canSave || saving}
                onClick={() => void saveSelectedFlag()}
              >
                {saving ? "Saving flag…" : "Save Flag"}
              </button>
              {locked && !saving && (
                <button
                  type="button"
                  onClick={() => {
                    resetFlag();
                    setStatus("Flag draft cleared.");
                  }}
                >
                  Clear flag draft
                </button>
              )}
            </>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
