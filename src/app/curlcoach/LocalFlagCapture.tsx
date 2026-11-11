"use client";

import { useEffect, useRef, useState } from "react";
import { captureShotFlagClip } from "@/lib/curlcoach/shot-flag-clip";
import EntryOverlay from "./EntryOverlay";

type Audience = "" | "team" | "player";
type Clip = Awaited<ReturnType<typeof captureShotFlagClip>> & { url: string };
type StartPoint = { time: number; selectedAt: string; capturedAt: string };
type SeekWindow = { first: number; last: number; duration: number };

export default function LocalFlagCapture({
  gameId,
  players,
  defaultPlayerId,
  onSaved,
}: {
  gameId: string;
  players: readonly { id: string; name: string }[];
  defaultPlayerId: string;
  onSaved: () => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [audience, setAudience] = useState<Audience>("");
  const [playerId, setPlayerId] = useState("");
  const [note, setNote] = useState("");
  const [clip, setClip] = useState<Clip | null>(null);
  const [start, setStart] = useState<StartPoint | null>(null);
  const [time, setTime] = useState(0);
  const [seekWindow, setSeekWindow] = useState<SeekWindow | null>(null);
  const [settled, setSettled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clipError, setClipError] = useState("");
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const selectedClipUrl = useRef<string | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const captureRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const payload = useRef<string | null>(null);
  const player = players.find((member) => member.id === playerId);
  const canPick = audience === "team" || (audience === "player" && !!player);
  const canSave = locked || canPick;
  const secondsBack = seekWindow ? Math.max(0, seekWindow.last - time) : 0;
  const seekLabel =
    secondsBack < 0.05
      ? "Newest frame"
      : `${secondsBack.toFixed(1)} seconds back`;

  useEffect(
    () => () => {
      captureRequest.current?.abort();
      saveRequest.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  function flushSeek() {
    const element = video.current;
    if (!element || element.seeking) return;
    if (pendingSeek.current !== null) {
      const target = pendingSeek.current;
      pendingSeek.current = null;
      if (Math.abs(element.currentTime - target) > 0.001) {
        element.currentTime = target;
        return;
      }
    }
    setSettled(element.readyState >= 2 && !element.seeking);
  }

  function seek(seconds: number, available = seekWindow) {
    if (!available || !video.current) return;
    const target = Math.max(available.first, Math.min(available.last, seconds));
    video.current.pause();
    setTime(target);
    setSettled(false);
    pendingSeek.current = target;
    flushSeek();
  }

  function clearClip() {
    setSeekWindow(null);
    setSettled(false);
    setPlaying(false);
    pendingSeek.current = null;
    setClip(null);
  }

  async function capture() {
    if (captureRequest.current) return;
    const controller = new AbortController();
    captureRequest.current = controller;
    setLoading(true);
    setClipError("");
    clearClip();
    try {
      const captured = await captureShotFlagClip(gameId, controller.signal);
      if (!controller.signal.aborted)
        setClip({ ...captured, url: URL.createObjectURL(captured.video) });
    } catch (error) {
      if (!controller.signal.aborted)
        setClipError(
          error instanceof Error
            ? error.message
            : "Could not load recent video.",
        );
    } finally {
      if (captureRequest.current === controller) {
        captureRequest.current = null;
        setLoading(false);
      }
    }
  }

  function closePicker() {
    captureRequest.current?.abort();
    captureRequest.current = null;
    setLoading(false);
    video.current?.pause();
    if (!clip || selectedClipUrl.current !== clip.url) clearClip();
  }

  function chooseStart() {
    const element = video.current;
    if (
      !clip ||
      !seekWindow ||
      !element ||
      !settled ||
      element.readyState < 2 ||
      element.seeking ||
      !element.paused ||
      pendingSeek.current !== null
    )
      return false;
    const selected = Math.max(
      seekWindow.first,
      Math.min(seekWindow.last, element.currentTime),
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
    clearClip();
    selectedClipUrl.current = null;
    setStart(null);
    setNote("");
    setLocked(false);
    payload.current = null;
  }

  async function save() {
    if (!start || !audience || !canSave || saveRequest.current) return;
    const controller = new AbortController();
    saveRequest.current = controller;
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
    try {
      const response = await fetch("/api/curlcoach/local-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload.current,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw Error("Could not save the flag. Try saving it again.");
      resetFlag();
      setStatus(
        `Flag saved for ${audience === "team" ? "the team" : player?.name}. Find it in Flagged shots.`,
      );
      onSaved();
    } catch {
      if (!controller.signal.aborted)
        setStatus("Could not save the flag. Your selection and note are kept.");
    } finally {
      if (saveRequest.current === controller) {
        saveRequest.current = null;
        if (!controller.signal.aborted) setSaving(false);
      }
    }
  }

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
              doneDisabled={!seekWindow || !settled || playing || !!clipError}
              onOpen={() => {
                if (!clip || clipError) void capture();
                else if (start && selectedClipUrl.current === clip.url)
                  seek(start.time);
              }}
              onDone={chooseStart}
              onClose={closePicker}
            >
              {loading && <p role="status">Loading recent video…</p>}
              {clipError && (
                <>
                  <p role="alert">{clipError}</p>
                  <button type="button" onClick={() => void capture()}>
                    Reload recent video
                  </button>
                </>
              )}
              {clip && !clipError && (
                <>
                  <video
                    className="shot-flag-video"
                    ref={video}
                    src={clip.url}
                    playsInline
                    muted
                    preload="auto"
                    onLoadedMetadata={({ currentTarget }) => {
                      const mediaDuration = currentTarget.duration;
                      const duration =
                        Number.isFinite(mediaDuration) && mediaDuration > 0
                          ? Math.min(mediaDuration, clip.duration)
                          : clip.duration;
                      // Seek just before EOF so the browser can show a frame.
                      const last = Math.max(0, duration - 0.05);
                      const first = Math.min(clip.minimum, last);
                      const available = { first, last, duration };
                      setSeekWindow(available);
                      seek(
                        start && selectedClipUrl.current === clip.url
                          ? start.time
                          : last,
                        available,
                      );
                    }}
                    onLoadedData={flushSeek}
                    onCanPlay={flushSeek}
                    onSeeking={() => setSettled(false)}
                    onSeeked={flushSeek}
                    onPlay={() => setPlaying(true)}
                    onPause={() => {
                      setPlaying(false);
                      flushSeek();
                    }}
                    onTimeUpdate={() => {
                      if (
                        pendingSeek.current === null &&
                        video.current &&
                        !video.current.seeking &&
                        seekWindow
                      ) {
                        const current = video.current.currentTime;
                        if (current > seekWindow.last && !video.current.paused)
                          seek(seekWindow.last);
                        else setTime(Math.min(seekWindow.last, current));
                      }
                    }}
                    onError={() => {
                      setSeekWindow(null);
                      setSettled(false);
                      setClipError(
                        "Video could not play. Reload recent video to try again.",
                      );
                    }}
                  />
                  {seekWindow && (
                    <label>
                      Shot start · {seekLabel}
                      <input
                        aria-label="Shot start"
                        aria-valuetext={seekLabel}
                        type="range"
                        min={seekWindow.first}
                        max={seekWindow.last}
                        step="any"
                        value={time}
                        onChange={(event) => seek(Number(event.target.value))}
                      />
                      <small>
                        Drag left to go back through the last{" "}
                        {Math.ceil(seekWindow.last - seekWindow.first)} seconds.
                      </small>
                    </label>
                  )}
                  <div className="shot-flag-playback">
                    <button
                      type="button"
                      disabled={!seekWindow}
                      onClick={() => seek(time - 1)}
                    >
                      −1 second
                    </button>
                    <button
                      type="button"
                      disabled={!seekWindow || (!playing && !settled)}
                      onClick={() => {
                        if (playing) video.current?.pause();
                        else
                          void video.current
                            ?.play()
                            .catch(() =>
                              setClipError(
                                "Video could not play. Reload recent video to try again.",
                              ),
                            );
                      }}
                    >
                      {playing ? "Pause" : "Play"}
                    </button>
                    <button
                      type="button"
                      disabled={!seekWindow}
                      onClick={() => seek(time + 1)}
                    >
                      +1 second
                    </button>
                  </div>
                </>
              )}
            </EntryOverlay>
          </div>
          {start && (
            <>
              <p>Start point selected</p>
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
                onClick={() => void save()}
              >
                {saving ? "Saving flag…" : "Finalize Flag"}
              </button>
            </>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
