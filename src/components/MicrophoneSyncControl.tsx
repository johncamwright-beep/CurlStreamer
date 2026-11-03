"use client";
import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_PROGRAM_AUDIO_DELAY_MS } from "@/lib/program-sync";

export function MicrophoneSyncControl({
  value,
  act,
}: {
  value?: number;
  act: (action: unknown) => Promise<void>;
}) {
  const initial = (value ?? DEFAULT_PROGRAM_AUDIO_DELAY_MS) / 1000;
  const inputId = useId();
  const confirmed = useRef(Math.round(initial * 1000));
  const [draft, setDraft] = useState(String(initial));
  const current = useRef(String(initial));
  const editing = useRef(false);
  const holding = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  function edit(text: string) {
    current.current = text;
    setDraft(text);
  }
  useEffect(() => {
    confirmed.current = Math.round(initial * 1000);
    if (!editing.current && !flight.current) {
      current.current = String(initial);
      setDraft(String(initial));
    }
  }, [initial]);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function save() {
    if (flight.current) return;
    const seconds = Number(current.current);
    if (
      !current.current.trim() ||
      !Number.isFinite(seconds) ||
      seconds < -5 ||
      seconds > 5
    ) {
      setError("Enter a number from −5 to +5 seconds.");
      return;
    }
    const milliseconds = Math.round(seconds * 1000);
    if (milliseconds === confirmed.current) {
      editing.current = false;
      setError("");
      return;
    }
    flight.current = true;
    setPending(true);
    setError("");
    try {
      await act({
        type: "program-audio-delay",
        milliseconds,
      });
      confirmed.current = milliseconds;
      edit(String(Math.round(seconds * 1000) / 1000));
    } catch {
      setError("Could not save microphone sync. Try again.");
    } finally {
      flight.current = false;
      editing.current = false;
      setPending(false);
    }
  }
  function step(direction: number) {
    const number = Number(current.current);
    edit(
      String(
        Math.round(
          Math.max(
            -5,
            Math.min(
              5,
              (Number.isFinite(number) ? number : initial) + direction,
            ),
          ) * 1000,
        ) / 1000,
      ),
    );
  }
  function release() {
    if (!holding.current) return;
    holding.current = false;
    clearTimeout(timer.current);
    void save();
  }
  return (
    <div>
      <label htmlFor={inputId}>Microphone sync adjustment (seconds)</label>
      <div className="flex items-center gap-2">
        {[-1, 1].map((direction) => (
          <button
            key={direction}
            type="button"
            className="btn-secondary min-h-11 min-w-11"
            disabled={pending}
            aria-label={
              direction < 0
                ? "Decrease microphone delay by 1 second"
                : "Increase microphone delay by 1 second"
            }
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              editing.current = true;
              holding.current = true;
              step(direction);
              let repeats = 0;
              const repeat = () => {
                if (!holding.current) return;
                step(direction);
                repeats++;
                timer.current = setTimeout(repeat, repeats < 3 ? 250 : 100);
              };
              timer.current = setTimeout(repeat, 550);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onClick={(event) => {
              if (event.detail === 0 && !holding.current) {
                step(direction);
                void save();
              }
            }}
          >
            {direction < 0 ? "−" : "+"}
          </button>
        ))}
        <input
          id={inputId}
          aria-label="Microphone sync adjustment"
          className="min-h-11 min-w-0 w-28"
          type="number"
          inputMode="decimal"
          min={-5}
          max={5}
          step="0.001"
          value={draft}
          disabled={pending}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(event) => edit(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
