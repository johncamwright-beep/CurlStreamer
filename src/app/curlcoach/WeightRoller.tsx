"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { label as formatLabel } from "@/lib/curlcoach/enhanced-catalog";
import "./WeightRoller.css";

type Props = {
  label?: string;
  weights: readonly string[];
  labels?: Readonly<Record<string, string>>;
  value?: string | null;
  initialValue?: string | null;
  blank?: string;
  disabled?: boolean;
  onCommit: (weight: string) => void;
};

const ROW_HEIGHT = 44;
const CENTER_ROW = 3;
const DRAG_STEP = 28;
const DRAG_THRESHOLD = 8;

type Drag = { id: number; y: number; position: number; moved: boolean };

/** The centered option is a preview until a release, tap, or keyboard confirmation. */
export default function WeightRoller({
  label = "Weight",
  weights,
  labels = {},
  value,
  initialValue,
  blank = "Not recorded",
  disabled = false,
  onCommit,
}: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wheel = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const seeded = !value && !!initialValue && weights.includes(initialValue);
  const previous = !!value && !weights.includes(value);
  const startingIndex = weights.indexOf(value || initialValue || "");
  const start =
    startingIndex >= 0 ? startingIndex : Math.floor(weights.length / 2);
  const [position, setPosition] = useState(start);
  const positionRef = useRef(start);
  const [open, setOpen] = useState(false);

  const bound = useCallback(
    (next: number) => Math.max(0, Math.min(weights.length - 1, next)),
    [weights.length],
  );
  const preview = useCallback(
    (next: number) => {
      positionRef.current = bound(next);
      setPosition(positionRef.current);
    },
    [bound],
  );

  useEffect(() => {
    const element = wheel.current;
    if (!element) return;
    function scroll(event: WheelEvent) {
      event.preventDefault();
      if (disabled || drag.current) return;
      const step =
        event.deltaMode === 1
          ? event.deltaY
          : event.deltaMode === 2
            ? event.deltaY * 7
            : event.deltaY / ROW_HEIGHT;
      preview(positionRef.current + step);
    }
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, [disabled, preview]);

  const cursor = Math.round(bound(position));
  const optionId = (index: number) => `${id}-option-${index}`;
  const name = (weight: string) => labels[weight] ?? formatLabel(weight);

  function dismiss() {
    drag.current = null;
    dialog.current?.close();
    setOpen(false);
  }

  function commit(weight: string) {
    if (disabled || !dialog.current?.open) return;
    dismiss();
    onCommit(weight);
  }

  function choose(index: number) {
    const weight = weights[index];
    if (weight !== undefined) commit(weight);
  }

  function dragPosition(active: Drag, clientY: number) {
    const distance = active.y - clientY;
    active.moved ||= Math.abs(distance) >= DRAG_THRESHOLD;
    // A short drag can step through nearby weights; a longer swipe covers the
    // full catalogue without requiring one row height of thumb travel per step.
    const extra =
      (Math.sign(distance) * Math.max(0, Math.abs(distance) - 112)) / DRAG_STEP;
    return active.position + distance / DRAG_STEP + extra;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || drag.current || !event.isPrimary || event.button !== 0)
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      position: positionRef.current,
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (active?.id !== event.pointerId) return;
    const next = dragPosition(active, event.clientY);
    if (active.moved) preview(next);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (active?.id !== event.pointerId) return;
    drag.current = null;
    const next = dragPosition(active, event.clientY);
    if (active.moved) {
      choose(Math.round(bound(next)));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX >= rect.left &&
      event.clientX < rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.bottom
    ) {
      const centerY = rect.top + rect.height / 2;
      choose(
        Math.round(active.position + (event.clientY - centerY) / ROW_HEIGHT),
      );
    }
  }

  function cancelDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (active?.id !== event.pointerId) return;
    drag.current = null;
    preview(active.position);
  }

  return (
    <div className="shot-weight-roller-field">
      <span>{label}</span>
      <button
        ref={opener}
        type="button"
        className="shot-weight-roller-opener"
        aria-label={label}
        aria-describedby={`${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        disabled={disabled || (!weights.length && !value)}
        onClick={() => {
          preview(start);
          dialog.current?.showModal();
          setOpen(true);
          wheel.current?.focus({ preventScroll: true });
        }}
      >
        <span id={`${id}-value`}>
          {value ? name(value) : seeded ? name(initialValue) : blank}
          {seeded && (
            <small className="shot-weight-roller-context"> (called)</small>
          )}
          {previous && (
            <small className="shot-weight-roller-context">
              {" "}
              (previous selection)
            </small>
          )}
        </span>
        <span className="shot-weight-roller-chevron" aria-hidden="true" />
      </button>

      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        className="shot-weight-roller-dialog"
        aria-labelledby={`${id}-title`}
        onClose={() => {
          if (dialog.current?.open) return;
          drag.current = null;
          setOpen(false);
          opener.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            dismiss();
        }}
      >
        <header className="shot-weight-roller-header">
          <div>
            <h2 id={`${id}-title`}>{label}</h2>
            <p id={`${id}-hint`}>Drag and release to choose a weight.</p>
          </div>
          <button
            type="button"
            className="shot-weight-roller-cancel"
            aria-label={`Cancel ${label.toLowerCase()}`}
            onClick={dismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div
          ref={wheel}
          className="shot-weight-roller-wheel"
          role="listbox"
          tabIndex={0}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-hint`}
          aria-activedescendant={weights.length ? optionId(cursor) : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onKeyDown={(event) => {
            if (disabled || drag.current) return;
            const index = Math.round(positionRef.current);
            switch (event.key) {
              case "ArrowDown":
                preview(index + 1);
                break;
              case "ArrowUp":
                preview(index - 1);
                break;
              case "PageDown":
                preview(index + CENTER_ROW);
                break;
              case "PageUp":
                preview(index - CENTER_ROW);
                break;
              case "Home":
                preview(0);
                break;
              case "End":
                preview(weights.length - 1);
                break;
              case "Enter":
              case " ":
                choose(index);
                break;
              default:
                return;
            }
            event.preventDefault();
          }}
        >
          <div className="shot-weight-roller-center" aria-hidden="true" />
          <div
            className="shot-weight-roller-rail"
            role="presentation"
            style={{
              transform: `translateY(${(CENTER_ROW - bound(position)) * ROW_HEIGHT}px)`,
            }}
          >
            {weights.map((weight, index) => (
              <div
                key={weight}
                id={optionId(index)}
                className="shot-weight-roller-option"
                role="option"
                aria-selected={index === cursor}
                onClick={(event) => {
                  // Pointer selections commit on release; allow assistive
                  // technology to activate an option without a pointer.
                  if (event.detail === 0) choose(index);
                }}
              >
                {name(weight)}
              </div>
            ))}
          </div>
        </div>
        <footer className="shot-weight-roller-footer">
          <button
            type="button"
            aria-label="Clear weight"
            disabled={disabled || !value}
            onClick={() => commit("")}
          >
            Clear
          </button>
          <button
            type="button"
            className="shot-weight-roller-use"
            disabled={disabled || !weights.length}
            onClick={() => choose(Math.round(positionRef.current))}
          >
            Use weight
          </button>
        </footer>
      </dialog>
    </div>
  );
}
