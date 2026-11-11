"use client";
import { useEffect, useRef, useState } from "react";
import {
  captureLocalClip,
  localLaptopAddress,
  type LocalClip,
} from "@/lib/curlcoach/local-clip";
import EntryOverlay from "./EntryOverlay";

export default function LocalFlagCapture({
  gameId,
  playerId,
  playerName,
  scopeKey,
  onSaved,
}: {
  gameId: string;
  playerId: string;
  playerName: string;
  scopeKey: string;
  onSaved: () => void;
}) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(false);
  const [clip, setClip] = useState<
    (LocalClip & { url: string; id: string }) | null
  >(null);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audience, setAudience] = useState<"player" | "team">("player");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const target = useRef({ playerId, playerName });
  const payload = useRef<string | null>(null);
  const [saveStarted, setSaveStarted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    try {
      const stored = localStorage.getItem(`coach-laptop:${scopeKey}`);
      if (stored) setAddress(localLaptopAddress(stored));
    } catch {
      /* Optional preference. */
    }
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, [scopeKey]);
  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );
  function seek(seconds: number) {
    if (!clip || !video.current) return;
    video.current.pause();
    const target = Math.max(clip.minimum, Math.min(clip.duration, seconds));
    setTime(target);
    setSettled(false);
    pendingSeek.current = target;
    flushSeek();
  }
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
  async function capture() {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setMessage("Loading recent video from your laptop…");
    setReady(false);
    setSettled(false);
    request.current = new AbortController();
    try {
      const captured = await captureLocalClip(
        address,
        gameId,
        code,
        request.current.signal,
      );
      if (!active.current) return;
      target.current = { playerId, playerName };
      payload.current = null;
      setSaveStarted(false);
      setNote("");
      setClip({
        ...captured,
        url: URL.createObjectURL(captured.video),
        id: crypto.randomUUID(),
      });
      setCode("");
      setSetup(false);
      try {
        localStorage.setItem(
          `coach-laptop:${scopeKey}`,
          localLaptopAddress(address),
        );
      } catch {
        /* Optional preference. */
      }
      setMessage("Choose the shot start, then save your flag.");
    } catch (error) {
      if (active.current) {
        setMessage(
          error instanceof Error ? error.message : "Could not load video.",
        );
        setSetup(true);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function save() {
    if (
      !clip ||
      !settled ||
      playing ||
      busy ||
      saved ||
      !video.current ||
      video.current.seeking ||
      pendingSeek.current !== null
    )
      return;
    setBusy(true);
    setMessage("Saving flag…");
    setSaveStarted(true);
    try {
      const response = await fetch("/api/curlcoach/local-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          payload.current ??
          (payload.current = JSON.stringify({
            review: {
              version: 1,
              id: clip.id,
              gameId,
              audience,
              notes: note,
              selectedAt: new Date(
                Date.parse(clip.capturedAt) -
                  (clip.duration - video.current.currentTime) * 1000,
              ).toISOString(),
              capturedAt: clip.capturedAt,
              timingEstimated: true,
            },
            shotId: null,
            ...(audience === "player"
              ? { playerId: target.current.playerId }
              : {}),
            expectedRevision: 0,
          })),
      });
      if (!active.current) return;
      if (!response.ok)
        throw Error("Could not save flag. Your selection is kept; try again.");
      setSaved(true);
      setMessage(
        `Flag saved for ${audience === "team" ? "the team" : target.current.playerName}. Find it in Flagged shots.`,
      );
      onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save flag.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <EntryOverlay
      title="Flag recent video"
      onOpen={() => {
        if (!address) setSetup(true);
      }}
      onClose={() => {
        request.current?.abort();
        video.current?.pause();
      }}
    >
      <p>
        Scrub the last two minutes from your laptop. Video stays on your local
        network.
      </p>
      <button
        type="button"
        onClick={() => setSetup((value) => !value)}
        disabled={busy}
      >
        Laptop connection
      </button>
      {setup && (
        <div>
          <label>
            Laptop address
            <input
              type="url"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="http://192.168.8.188:3189"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label>
            Pairing code
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
            />
          </label>
          <small>
            For the first connection, use the address and code in Studio’s Phone
            review settings. The address is remembered; pairing lasts for this
            game.
          </small>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !address}
        onClick={() => void capture()}
      >
        {busy && !clip ? "Loading video…" : "Capture recent video"}
      </button>
      <p role="status">{message}</p>
      {clip && (
        <>
          <video
            ref={video}
            src={clip.url}
            playsInline
            muted
            preload="auto"
            style={{ width: "100%", maxHeight: "35vh", objectFit: "contain" }}
            onLoadedMetadata={() => {
              setReady(true);
              seek(Math.max(clip.minimum, clip.duration - 30));
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
                !video.current.seeking
              )
                setTime(video.current.currentTime);
            }}
            onError={() => {
              setReady(false);
              setSettled(false);
              setMessage(
                "Video could not play. Capture again or check your Wi-Fi.",
              );
            }}
          />
          <label>
            Shot start · {Math.max(0, clip.duration - time).toFixed(1)} seconds
            before capture
            <input
              aria-label="Shot start"
              type="range"
              min={clip.minimum}
              max={clip.duration}
              step="0.1"
              value={time}
              disabled={!ready || busy || saved || saveStarted}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!ready || busy || saved || saveStarted}
              onClick={() => seek(time - 1)}
            >
              −1 second
            </button>
            <button
              type="button"
              disabled={!ready || !settled || busy || saved || saveStarted}
              onClick={() => {
                if (playing) video.current?.pause();
                else
                  void video.current
                    ?.play()
                    .catch(() => setMessage("Tap Play again to preview."));
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              disabled={!ready || busy || saved || saveStarted}
              onClick={() => seek(time + 1)}
            >
              +1 second
            </button>
          </div>
          <label>
            Who should review this?
            <select
              value={audience}
              disabled={busy || saved || saveStarted}
              onChange={(e) => setAudience(e.target.value as "player" | "team")}
            >
              <option value="player">
                Player · {target.current.playerName}
              </option>
              <option value="team">Team</option>
            </select>
          </label>
          <label>
            Review notes
            <textarea
              maxLength={2000}
              rows={3}
              value={note}
              disabled={busy || saved || saveStarted}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={
              !ready ||
              !settled ||
              playing ||
              busy ||
              saved ||
              (audience === "player" && !playerId)
            }
            onClick={() => void save()}
          >
            {saved ? "Flag saved" : "Save flag"}
          </button>
        </>
      )}
    </EntryOverlay>
  );
}
