"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/** Stays inside the entry form: closing a panel never unmounts its draft controls. */
export default function EntryOverlay({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  function close() {
    dialog.current?.close();
  }
  return (
    <div className={`entry-overlay ${className}`}>
      <button
        ref={trigger}
        className="entry-overlay-trigger"
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <span aria-hidden="true">↗</span>
      </button>
      <dialog
        ref={dialog}
        className="entry-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }}
      >
        <header className="entry-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label={`Close ${title}`} onClick={close}>
            ×
          </button>
        </header>
        <div className="entry-dialog-content">{children}</div>
        <footer>
          <button type="button" onClick={close}>
            Done
          </button>
        </footer>
      </dialog>
    </div>
  );
}
